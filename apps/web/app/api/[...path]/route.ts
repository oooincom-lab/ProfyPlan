import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname.replace('/api', '');
  const search = request.nextUrl.search;
  const url = `https://profyplan.ru/api${path}${search}`;

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (key !== 'host' && key !== 'connection') headers[key] = value;
  });

  try {
    const res = await fetch(url, { headers, redirect: 'follow' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname.replace('/api', '');
  const search = request.nextUrl.search;
  const url = `https://profyplan.ru/api${path}${search}`;

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (key !== 'host' && key !== 'connection') headers[key] = value;
  });

  let body: string | undefined;
  try { body = await request.text(); } catch {}

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: body || undefined,
      redirect: 'follow',
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  const path = request.nextUrl.pathname.replace('/api', '');
  const search = request.nextUrl.search;
  const url = `https://profyplan.ru/api${path}${search}`;

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (key !== 'host' && key !== 'connection') headers[key] = value;
  });

  let body: string | undefined;
  try { body = await request.text(); } catch {}

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: body || undefined,
      redirect: 'follow',
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  const path = request.nextUrl.pathname.replace('/api', '');
  const search = request.nextUrl.search;
  const url = `https://profyplan.ru/api${path}${search}`;

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (key !== 'host' && key !== 'connection') headers[key] = value;
  });

  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers,
      redirect: 'follow',
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
