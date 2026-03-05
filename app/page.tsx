import { AppTopNav } from "@/components/AppTopNav";
import { HomeClient } from "@/components/HomeClient";

export default function Home() {
  return (
    <div className="min-h-screen">
      <AppTopNav active="capture" />

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <section>
          <HomeClient />
        </section>
      </main>
    </div>
  );
}
