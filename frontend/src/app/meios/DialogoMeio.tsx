"use client";

import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { api, ApiError } from "@/lib/api";
import {
  ESTADOS_MEIO, PROPRIEDADES, TIPOS_MEIO, type Alocacao, type EstadoMeio, type Meio, type Propriedade,
  type TipoCatalogo,
} from "@/lib/meios";
import type { Pessoa } from "@/lib/planeamento";
import s from "../planeamento/planeamento.module.css";
import p from "./meios.module.css";

type Erros = Record<string, string[]>;

interface Props {
  meio: Meio | null;
  podeEditar: boolean;
  podeEliminar: boolean;
  pessoas: Pessoa[];
  tipos: TipoCatalogo[];
  onFechar: () => void;
  onGuardado: () => void;
}

export default function DialogoMeio({ meio, podeEditar, podeEliminar, pessoas, tipos, onFechar, onGuardado }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState({
    codigo: meio?.codigo ?? "",
    nome: meio?.nome ?? "",
    tipo_meio: meio?.tipo_meio ? String(meio.tipo_meio) : "",
    capacidade: meio?.capacidade ? String(Number(meio.capacidade)).replace(".", ",") : "",
    propriedade: (meio?.propriedade ?? "proprio") as Propriedade,
    marca: meio?.marca ?? "",
    modelo: meio?.modelo ?? "",
    matricula: meio?.matricula ?? "",
    numero_serie: meio?.numero_serie ?? "",
    responsavel: meio?.responsavel ? String(meio.responsavel) : "",
    estado: (meio?.estado ?? "operacional") as EstadoMeio,
    activo: meio?.activo ?? true,
    fornecedor: meio?.fornecedor ?? "",
    po_referencia: meio?.po_referencia ?? "",
    notas: meio?.notas ?? "",
  });
  const [erros, setErros] = useState<Erros>({});
  const [aGuardar, setAGuardar] = useState(false);
  const [agenda, setAgenda] = useState<Alocacao[] | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    if (!meio) return;
    api<{ alocacoes: Alocacao[] }>(`/meios/${meio.id}/calendario/`)
      .then((r) => setAgenda(r.alocacoes))
      .catch(() => setAgenda([]));
  }, [meio]);

  const so = !podeEditar;
  const tipoEscolhido = tipos.find((x) => String(x.id) === f.tipo_meio);
  const unidade = tipoEscolhido?.unidade ?? "";
  function mudar<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((x) => ({ ...x, [k]: v }));
    setErros((e) => { const r = { ...e }; delete r[k]; return r; });
  }

  async function guardar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (so) return;
    const loc: Erros = {};
    if (!f.codigo.trim()) loc.codigo = ["Indique o código."];
    if (!f.nome.trim()) loc.nome = ["Indique o nome."];
    if (!f.tipo_meio) loc.tipo_meio = ["Escolha o tipo."];
    const cap = f.capacidade.trim() ? Number(f.capacidade.replace(",", ".")) : null;
    if (unidade && cap !== null && !(cap > 0)) loc.capacidade = ["Número maior que zero."];
    setErros(loc);
    if (Object.keys(loc).length) return;
    setAGuardar(true);
    try {
      await api(meio ? `/meios/${meio.id}/` : "/meios/", {
        method: meio ? "PATCH" : "POST",
        body: JSON.stringify({
          ...f,
          tipo_meio: Number(f.tipo_meio),
          capacidade: unidade && cap !== null ? cap : null,
          responsavel: f.responsavel ? Number(f.responsavel) : null,
        }),
      });
      onGuardado();
    } catch (err) {
      if (err instanceof ApiError) setErros(Object.keys(err.campos).length ? err.campos : { non_field_errors: [err.message] });
    } finally {
      setAGuardar(false);
    }
  }

  async function eliminar() {
    if (!meio || !window.confirm(`Eliminar ${meio.codigo}?`)) return;
    try {
      await api(`/meios/${meio.id}/`, { method: "DELETE" });
      onGuardado();
    } catch (err) {
      setErros({ non_field_errors: [err instanceof ApiError ? err.message : "Não foi possível eliminar."] });
    }
  }

  const E = ({ c }: { c: string }) => (erros[c]?.length ? <span className={s.erroCampo}>{erros[c].join(" ")}</span> : null);

  return (
    <dialog ref={ref} className={s.dialogo} onClose={onFechar} aria-labelledby="dlg-meio">
      <form onSubmit={guardar} noValidate>
        <header className={s.dlgCab}>
          <div>
            <span className="eyebrow">{meio ? (so ? "Meio" : "Editar meio") : "Novo meio no parque"}</span>
            <h2 id="dlg-meio">{meio ? `${meio.codigo} · ${meio.nome}` : "Viatura, ferramenta ou equipamento"}</h2>
          </div>
          <button type="button" className={s.fechar} onClick={onFechar} aria-label="Fechar">×</button>
        </header>
        <fieldset className={s.dlgCorpo} disabled={so || aGuardar}>
          <div className={s.grelha2}>
            <label className={s.campo}>Tipo
              <select value={f.tipo_meio} onChange={(e) => mudar("tipo_meio", e.target.value)} aria-invalid={Boolean(erros.tipo_meio)}>
                <option value="">— escolher —</option>
                {TIPOS_MEIO.map((c) => (
                  <optgroup key={c.id} label={c.nome}>
                    {tipos.filter((x) => x.categoria === c.id && (x.activo || String(x.id) === f.tipo_meio)).map((x) => (
                      <option key={x.id} value={x.id}>{x.nome}{x.unidade ? ` (${x.unidade})` : ""}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <E c="tipo_meio" />
              {meio && !meio.tipo_meio && <span className={s.dica}>Registado antes do catálogo: escolha o tipo.</span>}
            </label>
            {unidade ? (
              <label className={s.campo}>Capacidade ({unidade})
                <input type="text" inputMode="decimal" value={f.capacidade} onChange={(e) => mudar("capacidade", e.target.value)}
                       placeholder={tipoEscolhido?.descricao || `em ${unidade}`} aria-invalid={Boolean(erros.capacidade)} />
                <E c="capacidade" />
              </label>
            ) : <span />}
          </div>
          <div className={s.grelha2}>
            <label className={s.campo}>Propriedade
              <select value={f.propriedade} onChange={(e) => mudar("propriedade", e.target.value as Propriedade)}>
                {PROPRIEDADES.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </label>
          </div>
          <div className={s.grelha2}>
            <label className={s.campo}>Código
              <input type="text" value={f.codigo} onChange={(e) => mudar("codigo", e.target.value)} placeholder="ex.: VTR-01" />
              <E c="codigo" />
            </label>
            <label className={s.campo}>Nome
              <input type="text" value={f.nome} onChange={(e) => mudar("nome", e.target.value)}
                     placeholder={tipoEscolhido?.categoria === "pesado" ? "ex.: Grua Liebherr LTM 1050" : tipoEscolhido?.categoria === "ferramenta" ? "ex.: Fluke 707" : "ex.: Toyota Hilux"} />
              <E c="nome" />
            </label>
          </div>
          <div className={s.grelha4}>
            <label className={s.campo}>Marca<input type="text" value={f.marca} onChange={(e) => mudar("marca", e.target.value)} /></label>
            <label className={s.campo}>Modelo<input type="text" value={f.modelo} onChange={(e) => mudar("modelo", e.target.value)} /></label>
            <label className={s.campo}>Matrícula<input type="text" value={f.matricula} onChange={(e) => mudar("matricula", e.target.value)} /></label>
            <label className={s.campo}>Nº de série<input type="text" value={f.numero_serie} onChange={(e) => mudar("numero_serie", e.target.value)} /></label>
          </div>
          <div className={s.grelha2}>
            <label className={s.campo}>Estado operacional
              <select value={f.estado} onChange={(e) => mudar("estado", e.target.value as EstadoMeio)}>
                {ESTADOS_MEIO.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
              <span className={s.dica}>Em manutenção ou avariado: deixa de aparecer como disponível.</span>
            </label>
            <label className={s.campo}>Responsável (quem o guarda)
              <select value={f.responsavel} onChange={(e) => mudar("responsavel", e.target.value)}>
                <option value="">—</option>
                {pessoas.filter((x) => x.activo || String(x.id) === f.responsavel).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
              </select>
            </label>
          </div>
          {f.propriedade === "alugado" && (
            <div className={s.grelha2}>
              <label className={s.campo}>Referência da PO<input type="text" value={f.po_referencia} onChange={(e) => mudar("po_referencia", e.target.value)} /></label>
              <label className={s.campo}>Fornecedor<input type="text" value={f.fornecedor} onChange={(e) => mudar("fornecedor", e.target.value)} /></label>
            </div>
          )}
          <label className={s.checkLinha}>
            <input type="checkbox" checked={f.activo} onChange={(e) => mudar("activo", e.target.checked)} />
            No parque (activo). Desmarque quando o meio sai definitivamente.
          </label>
          <label className={s.campo}>Notas<textarea rows={2} value={f.notas} onChange={(e) => mudar("notas", e.target.value)} /></label>
          {erros.non_field_errors && <p className={s.erro} role="alert">{erros.non_field_errors.join(" ")}</p>}

          {meio && (
            <div className={p.calendario}>
              <b>Afectações (semana passada e próximas 5 semanas)</b>
              {agenda === null ? <span className={s.dica}>A carregar…</span>
                : !agenda.length ? <span className={s.dica}>Livre em todo o período.</span>
                : (
                  <ul>
                    {agenda.map((a) => (
                      <li key={a.id}><b>{a.periodo}</b> · {a.onde}{a.pessoa_nome ? ` · ${a.pessoa_nome}` : ""}</li>
                    ))}
                  </ul>
                )}
            </div>
          )}
        </fieldset>
        <footer className={s.dlgRodape}>
          {meio && podeEliminar && (
            <div className={s.eliminar}>
              <button type="button" className={s.btnPerigoLeve} onClick={eliminar}>Eliminar</button>
            </div>
          )}
          <button type="button" className="btn" onClick={onFechar}>{so ? "Fechar" : "Cancelar"}</button>
          {!so && (
            <button type="submit" className={s.btnPrimario} disabled={aGuardar}>
              {aGuardar ? "A guardar…" : meio ? "Guardar alterações" : "Acrescentar ao parque"}
            </button>
          )}
        </footer>
      </form>
    </dialog>
  );
}
