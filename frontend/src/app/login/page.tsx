"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ApiError, iniciarSessao, temSessao } from "@/lib/api";
import s from "./login.module.css";

function FormularioLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const { definirUtilizador } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Só aceita destinos internos (evita redireccionar para outro site)
  const destino = (() => {
    const n = params.get("next");
    return n && n.startsWith("/") && !n.startsWith("//") && n !== "/"? n : "/projecto";
  })();

  useEffect(() => {
    if (temSessao()) router.replace(destino);
  }, [router, destino]);

  async function entrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErro("Indique o utilizador e a palavra-passe.");
      return;
    }
    setErro(null);
    setAEnviar(true);
    try {
      const u = await iniciarSessao(username.trim(), password);
      definirUtilizador(u);
      router.replace(destino);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Ocorreu um erro inesperado. Tente novamente.");
      setAEnviar(false);
    }
  }

  return (
    <form className={s.form} onSubmit={entrar} noValidate>
      <div className={s.cabecalho}>
        <Image src="/icon.png" alt="" width={52} height={52} className={s.icone} />
        <div>
          <h1>Iniciar sessão</h1>
          <p className="sub">Acompanhamento da telegestão · ProÁgua Pilar 2</p>
        </div>
      </div>

      <label className="f">
        Utilizador
        <input
          id="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={aEnviar}
          autoFocus
        />
      </label>

      <label className="f">
        Palavra-passe
        <span className={s.campoPass}>
          <input
            id="password"
            type={mostrar ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={aEnviar}
          />
          <button
            type="button"
            className={s.mostrar}
            onClick={() => setMostrar((v) => !v)}
            aria-pressed={mostrar}
            aria-controls="password"
          >
            {mostrar ? "Ocultar" : "Mostrar"}
          </button>
        </span>
      </label>

      {erro && (
        <p className={s.erro} role="alert">
          {erro}
        </p>
      )}

      <button type="submit" className={s.entrar} disabled={aEnviar} aria-busy={aEnviar}>
        <span className={s.entrarTexto}>
          {aEnviar ? "A verificar…" : "Entrar"}
          {!aEnviar && (
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" className={s.seta}>
              <path d="M4 10h11M11 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <span className={s.cabo} aria-hidden="true"><i /></span>
      </button>

      <p className={s.ajuda}>Problemas de acesso? Contacte o administrador da plataforma.</p>
    </form>
  );
}

export default function PaginaLogin() {
  return (
    <div className={s.pagina}>
      <aside className={s.lado}>
        <div className={s.marca}>
          <span className={s.nome}>SCADA <i>Progression</i></span>
          <span className={s.slogan}>Do RTU ao centro de controlo, cada ligação conta.</span>
        </div>
        <div className={s.ilustracao}>
          <Image
            src="/logo-ilustracao.png"
            alt="Técnico com equipamento de protecção a ligar um RTU de telegestão a um armário PLC"
            width={1000}
            height={427}
            priority
          />
        </div>
        <p className={s.rodape}>Telegestão · ProÁgua Pilar 2 · SUEZ · Mitrelli · EPAL-EP</p>
      </aside>

      <main className={s.principal}>
        <Suspense fallback={null}>
          <FormularioLogin />
        </Suspense>
      </main>
    </div>
  );
}