export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  return Response.json({
    ok: true,
    app: 'ok',
    commit: process.env.BUILD_COMMIT || process.env.GIT_COMMIT || 'dev',
    checkedAt: new Date().toISOString(),
    config: {
      ai: Boolean(process.env.DEEPSEEK_API_KEY),
      supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      cronAuth: Boolean(process.env.CRON_SECRET),
    },
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
