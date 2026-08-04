/**
 * CCM page — редирект на V2 с авторизацией и фактическим выполнением.
 */
import { redirect } from 'next/navigation';

export default function CCMPage() {
  redirect('/ccm-v2');
}
