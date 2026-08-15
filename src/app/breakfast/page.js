import { redirect } from 'next/navigation';

export default function BreakfastRedirect() {
  redirect('/?tab=breakfast');
}
