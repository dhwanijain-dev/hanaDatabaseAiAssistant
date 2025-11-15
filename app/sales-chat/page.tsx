import SalesChatbot from "@/components/sales-chatbot";

export const metadata = {
  title: "Sales Chatbot",
};

export default function Page() {
  return (
    <main className="min-h-screen flex flex-col items-center p-6">
      <div className="w-full max-w-5xl">
        <SalesChatbot />
      </div>
    </main>
  );
}
