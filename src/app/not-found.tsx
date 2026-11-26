import Link from "next/link";
import { Search } from "lucide-react";
import { Brand, Button, Empty } from "@/components/ui/primitives";

export default function NotFound() {
  return <main className="center-page page-stack"><Brand />
    <div className="panel"><Empty icon={Search} title="Página indisponível" description="Confira o endereço ou volte para a página inicial.">
      <Button asChild><Link href="/">Ir para o início</Link></Button>
    </Empty></div>
  </main>;
}
