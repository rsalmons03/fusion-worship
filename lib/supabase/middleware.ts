import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Refreshes the session on every request and sends signed-out visitors to /login.
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic =
    path === "/login" ||
    path.startsWith("/auth") ||
    path.startsWith("/respond") || // accept/decline link from email; secured by its token
    path === "/api/respond";

  const toLogin = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  };

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return isPublic ? NextResponse.next({ request }) : toLogin();
  }

  let response = NextResponse.next({ request });
  try {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });

    // Do not run code between createServerClient and getUser().
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user && !isPublic) return toLogin();
    if (user && path === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return response;
  } catch (err) {
    console.error("middleware updateSession error:", err);
    return isPublic ? response : toLogin();
  }
}
