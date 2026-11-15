"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";

const PERFIS = { admin: "Administrador", tecnico: "Técnico", leitor: "Leitor" } as const;

export default function Header() {
  const { utilizador, sair } = useAuth();
  const pathname = usePathname();

  return (
    <header className="topbar">
      <div className="wrap">
        <Link href="/projecto" className="brand" aria-label="SCADA Progression — início">
          <span className="brand-logo">
            <Image src="/logo-header.png" alt="" width={140} height={60} priority />
          </span>
          <b>SCADA <i>Progression</i></b>
        </Link>
        <nav className="tabs">
          <Link href="/projecto" aria-current={pathname.startsWith("/projecto") ? "page" : undefined}>Projecto</Link>
          <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>Estado RTU</Link>
          <Link href="/planeamento" aria-current={pathname.startsWith("/planeamento") ? "page" : undefined}>
            Planeamento
          </Link>
        </nav>
        {utilizador && (
          <div className="user-chip">
            <Link href="/perfil" className="user-link" title="O meu perfil"
                  aria-current={pathname === "/perfil" ? "page" : undefined}>
              <b>{utilizador.nome}</b>
              <span className="sub">{PERFIS[utilizador.perfil]}</span>
            </Link>
            <button type="button" className="btn" onClick={sair}>Sair</button>
          </div>
        )}
      </div>
    </header>
  );
}