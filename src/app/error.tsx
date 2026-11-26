"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button, Empty } from "@/components/ui/primitives";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="center-page panel">
    <Empty icon={TriangleAlert} title="Não foi possível carregar esta página" description="Confira sua conexão e tente carregar novamente.">
      <div className="title-actions"><Button onClick={reset}>Tentar novamente</Button><Button asChild variant="secondary"><Link href="/">Voltar ao início</Link></Button></div>
    </Empty>
  </main>;
}
