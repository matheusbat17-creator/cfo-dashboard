import { createClient } from "@supabase/supabase-js";

// A chave "publishable" é pública por desenho: sozinha ela não abre nada.
// Todo acesso aos dados exige login e passa pelo RLS (só o e-mail do dono).
export const sb = createClient(
  "https://ygyifpcpweguurdyrnmm.supabase.co",
  "sb_publishable_t1sQvkdv8qxrDc7DhSmRQA_zlIsQg6H",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);
