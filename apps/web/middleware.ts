import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Прежние адреса входа.
// Отдельного экрана входа в приложении нет и не было: вход выполняется внутри
// рабочей области (при необходимости там показывается форма входа). Чтобы старые
// ссылки, закладки и письма не приводили к странице «не найдено», эти адреса
// перенаправляются в рабочую область.
const LEGACY_LOGIN_PATHS = new Set([
  '/login',
  '/auth/login',
  '/signin',
  '/sign-in',
  '/authorize',
]);

export function middleware(request: NextRequest) {
  // Нормализуем путь: убираем завершающий слеш и приводим к нижнему регистру.
  const pathname = request.nextUrl.pathname.replace(/\/+$/, '').toLowerCase() || '/';

  if (LEGACY_LOGIN_PATHS.has(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/workspace';
    url.search = '';
    return NextResponse.redirect(url, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/login', '/auth/login', '/signin', '/sign-in', '/authorize'],
};
