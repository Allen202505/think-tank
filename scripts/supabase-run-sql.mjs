// 通过 Supabase Management API 执行 SQL（建表/种子）
// 用法：
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/supabase-run-sql.mjs supabase/schema.sql
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/supabase-run-sql.mjs supabase/seed_naval_issues.sql
// 项目 ref 从 NEXT_PUBLIC_SUPABASE_URL 自动读取（.env.local）
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const token = process.env.SUPABASE_ACCESS_TOKEN || '';
if (!token) {
  console.error('缺少 SUPABASE_ACCESS_TOKEN（在 Supabase 账户 → Access Tokens 创建，形如 sbp_xxx）');
  process.exit(1);
}
const sqlFile = process.argv[2];
if (!sqlFile) { console.error('用法：SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/supabase-run-sql.mjs <sql文件>'); process.exit(1); }

// 读取 .env.local 里的项目 ref
let ref = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
if (!ref) {
  try {
    const env = await fs.readFile(path.join(os.homedir(), 'Desktop/think-tank/.env.local'), 'utf8');
    const m = env.match(/NEXT_PUBLIC_SUPABASE_URL=https:\/\/([a-z0-9]+)\.supabase\.co/);
    if (m) ref = m[1];
  } catch (e) { /* ignore */ }
}
ref = ref.replace(/^https:\/\//, '').split('.')[0];
if (!ref) { console.error('无法确定 Supabase 项目 ref'); process.exit(1); }

const sql = await fs.readFile(sqlFile, 'utf8');
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`执行失败 HTTP ${res.status}:`, text.slice(0, 800));
  process.exit(1);
}
console.log(`✅ ${sqlFile} 执行成功（${sql.length} 字符）`);
try {
  const j = JSON.parse(text);
  if (Array.isArray(j) && j.length) console.log('返回行数：', j.length);
} catch (e) { /* 无返回体 */ }
