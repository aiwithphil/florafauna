import Studio from "../components/Studio";
import Header from "@/components/Header";

export default function Home() {
  return (
    <div className="min-h-screen grid grid-rows-[64px_1fr]">
      <Header />
      <Studio />
    </div>
  );
}
