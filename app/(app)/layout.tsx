import Nav from "@/components/Nav";
import PendingNotice from "@/components/PendingNotice";
import { ProfileProvider } from "@/components/ProfileContext";
import { loadLocations, requireProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  if (!profile || profile.role === "pending") return <PendingNotice email={profile?.email ?? ""} />;
  const locations = await loadLocations();
  return (
    <ProfileProvider profile={profile} locations={locations}>
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </ProfileProvider>
  );
}
