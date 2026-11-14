"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { api, ApiError, descarregar } from "@/lib/api";
import {
  FASES, LOTES, SIMBOLO, SITUACAO_NOME, pct, situacao,
  type Lote, type Painel, type SitioResumo, type Situacao, type TipoSitio,
} from "@/lib/estado";
import { lista, type RespostaLista } from "@/lib/planeamento";
import s from "./painel.module.css";

interface Filtros {
  q: string;
  lote: "" | Lote;
  tipo: "" | TipoSitio;
  situacao: "" | Situacao;
}
const VAZIO: Filtros = { q: "", lote: "", tipo: "", situacao: "" };

function Celula({ v, global = false }: { v: number; global?: boolean }) {
  const sit = situacao(v);
  return (
    <span className={`${s.celula} ${global ? s.celulaGlobal : ""}`} data-sit={sit} title={SITUACAO_NOME[sit]}>
      <span className={s.simbolo} aria-hidden="true">{SIMBOLO[sit]}</span>
      <span className={s.valor}>{pct(v)}</span>
      <span className={s.barra} aria-hidden="true"><i style={{ width: `${Math.round(v * 100)}%` }} /></span>
    </span>
  );
}

export default function PaginaEstado() {
  const router = useRouter();
  const [painel, setPainel] = useState<Painel | null>(null);
  const [sitios, setSitios] = useState<SitioResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<Filtros>(VAZIO);
  const [aExportar, setAExportar] = useState(false);

  useEffect(() => {
    let cancelado = false;
    Promise.all([api<Painel>("/painel/"), api<RespostaLista<SitioResumo>>("/sitios/")])
      .then(([p, l]) => {
        if (cancelado) return;
        setPainel(p);
        setSitios(lista(l));
      })
      .catch((e) => !cancelado && setErro(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelado = true;
    };
  }, []);

  const visiveis = useMemo(() => {
    const q = filtros.q.trim().toLowerCase();
    return (sitios ?? []).filter((x) =>
      (!filtros.lote || x.lote === filtros.lote) &&
      (!filtros.tipo || x.tipo === filtros.tipo) &&
      (!filtros.situacao || situacao(x.progresso.global) === filtros.situacao) &&
      (!q || `${x.tipo} ${x.nome} ${x.rtu_modelo} ${x.ferramenta}`.toLowerCase().includes(q)));
  }, [sitios, filtros]);

  const activos = Boolean(filtros.q || filtros.lote || filtros.tipo || filtros.situacao);

  function mudar<K extends keyof Filtros>(k: K, v: Filtros[K]) {
    setFiltros((f) => ({ ...f, [k]: v }));
  }

  async function exportar() {
    setAExportar(true);
    try {
      const { blob, nome } = await descarregar("/sitios/exportar/", "ProAgua_Estado_RTU_por_Sitio.xlsx");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível exportar.");
    } finally {
      setAExportar(false);
    }
  }

  return (
    <>
      <Header />
      <main className={`wrap ${s.pagina}`}>
        <div className={s.topo}>
          <div>
            <span className="eyebrow">Configuração e comissionamento dos RTU</span>
            <h1>Estado RTU por sítio</h1>
            {painel && (
              <p className={s.sub}>
                ProÁgua Pilar 2 · EPAL-EP · situação em {new Date(`${painel.data}T12:00:00`).toLocaleDateString("pt-PT")}
              </p>
            )}
          </div>
          <button type="button" className="btn" onClick={exportar} disabled={aExportar || !sitios}>
            {aExportar ? "A exportar…" : "Exportar Excel"}
          </button>
        </div>

        {erro && <p className={s.erro} role="alert">{erro}</p>}

        {painel && (
          <section className={s.resumo} aria-label="Resumo do progresso">
            <div className={s.global}>
              <span className={s.rotulo}>Progresso global do projecto</span>
              <span className={s.grande}>{pct(painel.progresso_global, 2)}</span>
              <span className={s.barraGrande} aria-hidden="true">
                <i style={{ width: `${painel.progresso_global * 100}%` }} />
              </span>
              <span className={s.nota}>Média do estado global dos {painel.sitios.total} sítios</span>
            </div>

            <div className={s.lotes}>
              {LOTES.map((l) => {
                const d = painel.por_lote[l.id];
                return (
                  <button key={l.id} type="button" className={s.lote} data-foco={l.id === "L1"}
                          aria-pressed={filtros.lote === l.id}
                          onClick={() => mudar("lote", filtros.lote === l.id ? "" : l.id)}>
                    <span className={s.rotulo}>{l.titulo}</span>
                    <span className={s.medio}>{pct(d.progresso, 2)}</span>
                    <span className={s.barraMedia} aria-hidden="true"><i style={{ width: `${d.progresso * 100}%` }} /></span>
                    <span className={s.nota}>{d.sitios} sítios</span>
                  </button>
                );
              })}
            </div>

            <div className={s.contagens}>
              {([["concluido", painel.sitios.concluidos], ["em_curso", painel.sitios.em_curso],
                 ["nao_iniciado", painel.sitios.nao_iniciados]] as [Situacao, number][]).map(([k, n]) => (
                <button key={k} type="button" className={s.contagem} data-sit={k}
                        aria-pressed={filtros.situacao === k}
                        onClick={() => mudar("situacao", filtros.situacao === k ? "" : k)}>
                  <span aria-hidden="true">{SIMBOLO[k]}</span>
                  <b>{n}</b> {SITUACAO_NOME[k].toLowerCase()}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className={s.filtros}>
          <input type="search" className={s.pesquisa} placeholder="Procurar sítio, modelo de RTU…"
                 value={filtros.q} onChange={(e) => mudar("q", e.target.value)} aria-label="Procurar" />
          <select value={filtros.lote} onChange={(e) => mudar("lote", e.target.value as Filtros["lote"])} aria-label="Lote">
            <option value="">Todos os lotes</option>
            {LOTES.map((l) => <option key={l.id} value={l.id}>{l.titulo.split(" —")[0]}</option>)}
          </select>
          <select value={filtros.tipo} onChange={(e) => mudar("tipo", e.target.value as Filtros["tipo"])} aria-label="Tipo">
            <option value="">Todos os tipos</option>
            <option value="CD">CD</option>
            <option value="ETA">ETA</option>
            <option value="UCD">UCD</option>
          </select>
          <select value={filtros.situacao} onChange={(e) => mudar("situacao", e.target.value as Filtros["situacao"])}
                  aria-label="Situação">
            <option value="">Todas as situações</option>
            {(Object.keys(SITUACAO_NOME) as Situacao[]).map((k) => <option key={k} value={k}>{SITUACAO_NOME[k]}</option>)}
          </select>
          {activos && <button type="button" className={s.limpar} onClick={() => setFiltros(VAZIO)}>Limpar filtros</button>}
        </div>

        <section className={s.quadro} aria-busy={sitios === null}>
          {sitios === null ? (
            <p className={s.vazio}>A carregar o estado dos sítios…</p>
          ) : !visiveis.length ? (
            <p className={s.vazio}>Nenhum sítio corresponde aos filtros.</p>
          ) : (
            <div className={s.rolagem}>
              <table className={s.tabela}>
                <thead>
                  <tr>
                    <th className={s.cTipo}>Tipo</th>
                    <th className={s.cSitio}>Sítio</th>
                    <th className={s.cRtu}>RTU (modelo) · ferramenta</th>
                    <th className={s.cEntradas}>Entradas DI/AI</th>
                    {FASES.map((f) => <th key={f.id} className={s.cFase}>{f.titulo}</th>)}
                    <th className={s.cFase}>Estado global</th>
                  </tr>
                </thead>
                {LOTES.map((l) => {
                  const linhas = visiveis.filter((x) => x.lote === l.id);
                  if (!linhas.length) return null;
                  return (
                    <tbody key={l.id}>
                      <tr className={s.linhaLote}>
                        <td colSpan={8}>
                          {l.titulo}
                          {painel && <span>{pct(painel.por_lote[l.id].progresso, 2)} · {linhas.length} sítios</span>}
                        </td>
                      </tr>
                      {linhas.map((x) => (
                        <tr key={x.id} className={s.linha} onClick={() => router.push(`/sitios/${x.id}`)}>
                          <td className={s.cTipo}><span className={s.tipo}>{x.tipo}</span></td>
                          <td className={s.cSitio}>
                            <Link href={`/sitios/${x.id}`} onClick={(e) => e.stopPropagation()}>{x.nome}</Link>
                          </td>
                          <td className={s.cRtu}>
                            {x.rtu_modelo || "—"}
                            {x.ferramenta && <small>{x.ferramenta}</small>}
                          </td>
                          <td className={s.cEntradas}>{x.entradas || "—"}</td>
                          {FASES.map((f) => <td key={f.id} className={s.cFase}><Celula v={x.progresso[f.id]} /></td>)}
                          <td className={s.cFase}><Celula v={x.progresso.global} global /></td>
                        </tr>
                      ))}
                    </tbody>
                  );
                })}
              </table>
            </div>
          )}
        </section>

        <footer className={s.legenda}>
          <div>
            <b>Legenda</b>
            {(Object.keys(SIMBOLO) as Situacao[]).map((k) => (
              <span key={k} className={s.item} data-sit={k}>
                {SIMBOLO[k]} {SITUACAO_NOME[k]} {k === "concluido" ? "(100%)" : k === "em_curso" ? "(>0 e <100%)" : "(0%)"}
              </span>
            ))}
          </div>
          <p>
            % de cada fase = Σ Realizado ÷ Σ Previsto (o Previsto vem do sinóptico de instrumentação). Estado global =
            média das três fases. A partilha com a SUEZ Digital Solutions é acompanhada na ficha do sítio mas não entra
            nas %. Clique num sítio para ver e actualizar o detalhe.
          </p>
        </footer>
      </main>
    </>
  );
}