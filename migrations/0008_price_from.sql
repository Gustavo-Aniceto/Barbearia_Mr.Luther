-- 0008: preço "a partir de" para serviços com valor variável (ex.: química).
alter table public.services add column if not exists price_is_minimum boolean not null default false;
comment on column public.services.price_is_minimum is 'Quando verdadeiro, o preço é o valor mínimo ("a partir de"); o valor final é definido no atendimento.';

create or replace function public.public_site() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('name', name, 'address', address, 'maps_url', maps_url, 'phone', phone, 'whatsapp', whatsapp,
        'instagram_url', instagram_url, 'privacy_email', privacy_email, 'rating_value', rating_value, 'rating_count', rating_count,
        'rating_source', rating_source, 'rating_updated_at', rating_updated_at, 'hero_title', hero_title, 'hero_subtitle', hero_subtitle,
        'hero_image_url', hero_image_url, 'about_title', about_title, 'about_text', about_text, 'about_highlights', about_highlights,
        'cancel_min_hours', cancel_min_hours, 'reschedule_min_hours', reschedule_min_hours, 'late_tolerance_minutes', late_tolerance_minutes,
        'min_advance_minutes', min_advance_minutes, 'booking_window_days', booking_window_days,
        'pickup_enabled', pickup_enabled, 'delivery_enabled', delivery_enabled, 'delivery_fee', delivery_fee,
        'referral_enabled', referral_enabled, 'referral_reward_description', referral_reward_description,
        'referral_reward_kind', referral_reward_kind, 'referral_reward_value', referral_reward_value)
      from business_settings where id = 1),
    'hours', (select coalesce(jsonb_agg(to_jsonb(h) order by weekday), '[]') from business_hours h),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by sort_order, name), '[]') from service_categories where active),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'photo_url', s.photo_url,
        'price', s.price, 'price_is_minimum', s.price_is_minimum, 'duration_minutes', s.duration_minutes, 'category_id', s.category_id, 'is_combo', s.is_combo,
        'bookable_online', s.bookable_online,
        'barber_ids', (select coalesce(jsonb_agg(bs.barber_id), '[]') from barber_services bs join barbers b on b.id = bs.barber_id where bs.service_id = s.id and b.active))
        order by s.sort_order, s.name), '[]') from services s where s.active),
    'barbers', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.display_name, 'bio', b.bio, 'specialties', b.specialties,
        'photo_url', b.photo_url, 'accepts_online_booking', b.accepts_online_booking,
        'service_ids', (select coalesce(jsonb_agg(service_id), '[]') from barber_services where barber_id = b.id)) order by b.sort_order, b.display_name), '[]')
      from barbers b where b.active),
    'gallery', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'image_url', image_url, 'caption', caption, 'category', category) order by sort_order, created_at), '[]') from gallery_images where active),
    'testimonials', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'author', author_name, 'rating', rating, 'content', content, 'created_at', created_at) order by created_at desc), '[]') from testimonials where status = 'aprovado'),
    'product_categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by sort_order, name), '[]') from product_categories),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'photo_url', p.photo_url,
        'price', p.price, 'category_id', p.category_id, 'track_stock', p.track_stock,
        'stock', case when p.track_stock then p.stock end, 'available', (not p.track_stock or p.stock > 0)) order by p.name), '[]') from products p where p.active),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name, 'description', pl.description, 'price', pl.price,
        'period_months', pl.period_months, 'product_discount_percent', pl.product_discount_percent, 'usage_rules', pl.usage_rules,
        'contract_conditions', pl.contract_conditions,
        'sold_out', pl.max_active_subscriptions is not null and (select count(*) from subscriptions s where s.plan_id = pl.id and s.status in ('ativa','pendente')) >= pl.max_active_subscriptions,
        'benefits', (select coalesce(jsonb_agg(jsonb_build_object('description', pb.description, 'quantity', pb.quantity_per_period, 'service_id', pb.service_id)), '[]') from plan_benefits pb where pb.plan_id = pl.id))
        order by pl.sort_order, pl.price), '[]') from plans pl where pl.active),
    'legal', (select coalesce(jsonb_object_agg(kind, jsonb_build_object('version', version, 'title', title, 'content', content, 'published_at', published_at)), '{}') from legal_documents where is_current)
  )
$$;
grant execute on function public.public_site() to app_user;
