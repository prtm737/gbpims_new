-- Remove policies depending on has_role()
DROP POLICY IF EXISTS "Staff and admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Staff and admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Staff and admins can read config" ON public.app_config;
DROP POLICY IF EXISTS "Admins manage config" ON public.app_config;

CREATE POLICY "Staff and admins can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'staff')
    )
  );

CREATE POLICY "Staff and admins can read config"
  ON public.app_config FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'staff')
    )
  );

CREATE POLICY "Admins manage config"
  ON public.app_config FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );
