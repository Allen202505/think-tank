import { redirect } from 'next/navigation';

// 兜底：未知路径（含误输入的 /** 等）一律跳回首页，避免用户看到 404
export default function CatchAll() {
  redirect('/');
}
