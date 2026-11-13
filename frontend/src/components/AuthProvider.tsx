"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, EVENTO_SESSAO_TERMINADA, temSessao, terminarSessao, type Utilizador } from "@/lib/api";

interface AuthCtx {
  utilizador: Utilizador | null;
  definirUtilizador: (u: Utilizador) => void;
  sair: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

const ROTAS_PUBLICAS = ["/", "/login"];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [utilizador, setUtilizador] = useState<Utilizador | null>(null);
  const [pronto, setPronto] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const publica = ROTAS_PUBLICAS.includes(pathname);

  useEffect(() => {
    let cancelado = false;
    if (publica) {
      setPronto(true);
      return;
    }
    if (!temSessao()) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      router.replace("/");
      return;
    }
    api<Utilizador>("/auth/eu/")
      .then((u) => !cancelado && setUtilizador(u))
      .catch(() => {
        terminarSessao();
        router.replace("/login");
      })
      .finally(() => !cancelado && setPronto(true));
    return () => {
      cancelado = true;
    };
  }, [publica, pathname, router]);

  // tOKEN EXPIRADO A MEIO DO TRABALHO (QUALQUER PEDIDO DEVOLVE 401): volat ao login.
  useEffect(() => {
    function aoTerminar() {
        setUtilizador(null);
        if (!ROTAS_PUBLICAS.includes(window.location.pathname)) {
            router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        }
    }
  }, [router]);

  const sair = useCallback(() => {
    terminarSessao();
    setUtilizador(null);
    router.replace("/login");
  }, [router]);

  if (!pronto && !publica) {
    return <div className="empty-state">A carregar…</div>;
  }

  return (
    <Ctx.Provider value={{ utilizador, definirUtilizador: setUtilizador, sair }}>{children}</Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth tem de ser usado dentro de <AuthProvider>");
  return ctx;
}