"use client";

import { useState, type SubmitEvent } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/components/AuthProvider";
import { api, ApiError, type Utilizador } from "@/lib/api";
import s from "./perfil.module.css";

const PERFIS = { admin: "Administrador", tecnico: "Técnico", leitor: "Leitor" } as const;

type Erros = Record<string, string[]>;

function semCampo(erros: Erros, campo: string): Erros {
  const resto = { ...erros };
  delete resto[campo];
  return resto;
}

function ErroCampo({ erros, campo }: { erros: Erros; campo: string }) {
  const lista = erros[campo];
  if (!lista?.length) return null;
  return (
    <span className={s.erroCampo} id={`erro-${campo}`}>
      {lista.join(" ")}
    </span>
  );
}

/* ---------------- Dados pessoais ---------------- */
function DadosPessoais({ utilizador }: { utilizador: Utilizador }) {
  const { definirUtilizador } = useAuth();
  const [form, setForm] = useState({
    first_name: utilizador.first_name,
    last_name: utilizador.last_name,
    nome: utilizador.nome,
    funcao: utilizador.funcao,
  });
  const [erros, setErros] = useState<Erros>({});
  const [aGuardar, setAGuardar] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const alterado =
    form.first_name !== utilizador.first_name ||
    form.last_name !== utilizador.last_name ||
    (utilizador.tem_pessoa && (form.nome !== utilizador.nome || form.funcao !== utilizador.funcao));

  function mudar(campo: keyof typeof form, valor: string) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setErros((e) => semCampo(e, campo)); // o erro desaparece quando o campo é corrigido
    setGuardado(false);
  }

  async function guardar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setErros({});
    setAGuardar(true);
    const corpo: Record<string, string> = { first_name: form.first_name, last_name: form.last_name };
    if (utilizador.tem_pessoa) {
      corpo.nome = form.nome;
      corpo.funcao = form.funcao;
    }
    try {
      const u = await api<Utilizador>("/auth/eu/", { method: "PATCH", body: JSON.stringify(corpo) });
      definirUtilizador(u);
      setGuardado(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setErros(Object.keys(err.campos).length ? err.campos : { non_field_errors: [err.message] });
      }
    } finally {
      setAGuardar(false);
    }
  }

  return (
    <form className={s.cartao} onSubmit={guardar} noValidate>
      <div className={s.cartaoCabecalho}>
        <h2>Dados pessoais</h2>
        <p className="sub">O nome de utilizador e o email só podem ser alterados pelo administrador.</p>
      </div>

      <div className={s.grelha}>
        <label className="f">
          Utilizador
          <input type="text" value={utilizador.username} readOnly disabled />
        </label>
        <label className="f">
          Email
          <input type="text" value={utilizador.email || "—"} readOnly disabled />
        </label>

        <label className="f">
          Nome próprio
          <input type="text" autoComplete="given-name" value={form.first_name}
                 onChange={(e) => mudar("first_name", e.target.value)} disabled={aGuardar} />
          <ErroCampo erros={erros} campo="first_name" />
        </label>
        <label className="f">
          Apelido
          <input type="text" autoComplete="family-name" value={form.last_name}
                 onChange={(e) => mudar("last_name", e.target.value)} disabled={aGuardar} />
          <ErroCampo erros={erros} campo="last_name" />
        </label>

        {utilizador.tem_pessoa && (
          <>
            <label className="f">
              Nome na equipa
              <input type="text" value={form.nome} onChange={(e) => mudar("nome", e.target.value)}
                     disabled={aGuardar} aria-invalid={Boolean(erros.nome)}
                     aria-describedby={erros.nome ? "erro-nome" : undefined} />
              <span className={s.dica}>Aparece no planeamento e nas tarefas.</span>
              <ErroCampo erros={erros} campo="nome" />
            </label>
            <label className="f">
              Função
              <input type="text" value={form.funcao} onChange={(e) => mudar("funcao", e.target.value)}
                     disabled={aGuardar} />
              <ErroCampo erros={erros} campo="funcao" />
            </label>
          </>
        )}
      </div>

      {erros.non_field_errors && <p className={s.erro} role="alert">{erros.non_field_errors.join(" ")}</p>}
      {guardado && <p className={s.sucesso} role="status">Dados actualizados.</p>}

      <div className={s.accoes}>
        <button type="submit" className={s.primario} disabled={!alterado || aGuardar}>
          {aGuardar ? "A guardar…" : "Guardar alterações"}
        </button>
      </div>
    </form>
  );
}

/* ---------------- Palavra-passe ---------------- */
function CampoPass({
  id, rotulo, valor, onChange, mostrar, autoComplete, erros, desactivado,
}: {
  id: string; rotulo: string; valor: string; onChange: (v: string) => void; mostrar: boolean;
  autoComplete: string; erros: Erros; desactivado: boolean;
}) {
  return (
    <label className="f">
      {rotulo}
      <input id={id} type={mostrar ? "text" : "password"} autoComplete={autoComplete} value={valor}
             onChange={(e) => onChange(e.target.value)} disabled={desactivado}
             aria-invalid={Boolean(erros[id])} aria-describedby={erros[id] ? `erro-${id}` : undefined} />
      <ErroCampo erros={erros} campo={id} />
    </label>
  );
}

function PalavraPasse() {
  const [actual, setActual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [erros, setErros] = useState<Erros>({});
  const [aGuardar, setAGuardar] = useState(false);
  const [alterada, setAlterada] = useState(false);

  // devolve um setter que também limpa o erro desse campo
  const comLimpeza = (campo: string, set: (v: string) => void) => (v: string) => {
    set(v);
    setAlterada(false);
    setErros((e) => semCampo(e, campo));
  };

  async function alterar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setAlterada(false);
    const locais: Erros = {};
    if (!actual) locais.actual = ["Indique a palavra-passe actual."];
    if (!nova) locais.nova = ["Indique a nova palavra-passe."];
    if (nova && confirmacao !== nova) locais.confirmacao = ["A confirmação não coincide com a nova palavra-passe."];
    setErros(locais);
    if (Object.keys(locais).length) return;

    setAGuardar(true);
    try {
      await api("/auth/eu/palavra-passe/", {
        method: "POST",
        body: JSON.stringify({ actual, nova, confirmacao }),
      });
      setActual("");
      setNova("");
      setConfirmacao("");
      setAlterada(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setErros(Object.keys(err.campos).length ? err.campos : { non_field_errors: [err.message] });
      }
    } finally {
      setAGuardar(false);
    }
  }

  return (
    <form className={s.cartao} onSubmit={alterar} noValidate>
      <div className={s.cartaoCabecalho}>
        <h2>Alterar palavra-passe</h2>
        <p className="sub">Pelo menos 8 caracteres, sem ser demasiado comum nem parecida com o seu utilizador.</p>
      </div>

      {/* ajuda os gestores de palavras-passe a associar a conta */}
      <input type="text" name="username" autoComplete="username" hidden readOnly />

      <div className={s.coluna}>
        <CampoPass id="actual" rotulo="Palavra-passe actual" valor={actual} onChange={comLimpeza("actual", setActual)}
                   mostrar={mostrar} autoComplete="current-password" erros={erros} desactivado={aGuardar} />
        <CampoPass id="nova" rotulo="Nova palavra-passe" valor={nova} onChange={comLimpeza("nova", setNova)}
                   mostrar={mostrar} autoComplete="new-password" erros={erros} desactivado={aGuardar} />
        <CampoPass id="confirmacao" rotulo="Confirmar nova palavra-passe" valor={confirmacao}
                   onChange={comLimpeza("confirmacao", setConfirmacao)} mostrar={mostrar} autoComplete="new-password" erros={erros}
                   desactivado={aGuardar} />
        <label className={s.mostrar}>
          <input type="checkbox" checked={mostrar} onChange={(e) => setMostrar(e.target.checked)} />
          Mostrar palavras-passe
        </label>
      </div>

      {erros.non_field_errors && <p className={s.erro} role="alert">{erros.non_field_errors.join(" ")}</p>}
      {alterada && (
        <p className={s.sucesso} role="status">
          Palavra-passe alterada. Use a nova palavra-passe no próximo início de sessão.
        </p>
      )}

      <div className={s.accoes}>
        <button type="submit" className={s.primario} disabled={aGuardar}>
          {aGuardar ? "A alterar…" : "Alterar palavra-passe"}
        </button>
      </div>
    </form>
  );
}

/* ---------------- Página ---------------- */
export default function PaginaPerfil() {
  const { utilizador } = useAuth();

  return (
    <>
      <Header />
      <main className={`wrap ${s.pagina}`}>
        <div className={s.titulo}>
          <span className="eyebrow">A minha conta</span>
          <h1>{utilizador?.nome ?? "Perfil"}</h1>
          {utilizador && <span className={s.perfil}>{PERFIS[utilizador.perfil]}</span>}
        </div>

        {utilizador && (
          <div className={s.cartoes}>
            <DadosPessoais key={utilizador.id} utilizador={utilizador} />
            <PalavraPasse />
          </div>
        )}
      </main>
    </>
  );
}