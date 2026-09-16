import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// vendor/supabase.js 是官方自包含的 UMD 构建，以普通 <script> 先行加载，
// 因此这里从全局对象取 createClient，无需构建工具。
const { createClient } = window.supabase;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
