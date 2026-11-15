"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { api } from "@/lib/api";
import { FASES, LOTES, SIMBOLO, SITUACAO_NOME, pct, situacao, type Situacao } from "@/lib/estado";
import { SISTEMAS, num, type Dashboard, type Sistema } from "@/lib/projecto";
import s from "./projecto.module.css";

function Barra({ v, grande = false }: { v: number; grande?: boolean }) {
  return (
    <span className={grande ? s.barraGrande : s.barra} data-sit={situacao(v)} aria-hidden="true">
      <i style={{ width: `${Math.min(100, v * 100)}%` }} />
    </span>
  );
}

function Celula({ v, forte = false }: { v: number; forte?: boolean }) {
  const sit = situacao(v);
  return (
    <span className={s.celula} data-sit={sit} data-forte={forte} title={SITUACAO_NOME[sit]}>
      <b>{pct(v)}</b>
      <Barra v={v} />
    </span>
  );
}

export default function PaginaProjecto() {
  const router = useRouter();
  const [d, setD] = useState<Dashboard | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sistema, setSistema] = useState<"" | Sistema>("");
  const [lote, setLote] = useState("");
  const [sit, setSit] = useState<"" | Situacao>("");
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelado = false;
    api<Dashboard>("/dashboard/")
      .then((r) => !cancelado && setD(r))
      .catch((e) => !cancelado && setErro(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelado = true;
    };
  }, []);

  const visiveis = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (d?.por_sitio ?? []).filter((x) =>
      (!sistema || x.sistema === sistema) && (!lote || x.lote === lote) &&
      (!sit || situacao(x.global) === sit) && (!t || `${x.tipo} ${x.nome}`.toLowerCase().includes(t)));
  }, [d, sistema, lote, sit, q]);

  const activos = Boolean(sistema || lote || sit || q);
  const maxCat = Math.max(1, ...(d?.por_categoria ?? []).map((c) => c.p));

  return (
    <>
      <Header />
      <main className={`wrap ${s.pagina}`}>
        <div className={s.topo}>
          <div>
            <span className="eyebrow">ProÁgua Pilar 2 · telegestão EPAL-EP</span>
            <h1>Progresso do projecto</h1>
            {d && (
              <p className={s.sub}>
                {d.sitios.total} sítios · {num(d.elementos.total)} elementos de campo do sinóptico ·
                situação em {new Date(`${d.data}T12:00:00`).toLocaleDateString("pt-PT")}
              </p>
            )}
          </div>
          <Link href="/projecto/pendentes" className="btn">Ver pendentes no terreno</Link>
        </div>

        {erro && <p className={s.erro} role="alert">{erro}</p>}
        {!d && !erro && <p className={s.vazio}>A carregar o progresso do projecto…</p>}

        {d && (
          <>
            <section className={s.resumo} aria-label="Resumo">
              <div className={s.global}>
                <span className={s.rotulo}>Progresso global</span>
                <span className={s.grande}>{pct(d.progresso_global, 2)}</span>
                <Barra v={d.progresso_global} grande />
                <span className={s.nota}>Média do estado global dos {d.sitios.total} sítios</span>
              </div>
              <div className={s.fases}>
                {FASES.map((f) => (
                  <div key={f.id} className={s.fase}>
                    <span className={s.rotulo}>{f.titulo}</span>
                    <span className={s.medio}>{pct(d.fases[f.id], 2)}</span>
                    <Barra v={d.fases[f.id]} />
                    <span className={s.nota}>
                      {f.id === "mon"
                        ? `${num(d.elementos.pontos_concluidos)} de ${num(d.elementos.pontos_previstos)} pontos de campo`
                        : "P/R das actividades do sítio"}
                    </span>
                  </div>
                ))}
              </div>
              <div className={s.pendentes}>
                <Link href="/projecto/pendentes?vista=falta_instalar" className={s.pendente} data-tom="crit">
                  <b>{num(d.elementos.por_instalar)}</b> elementos por instalar
                </Link>
                <Link href="/projecto/pendentes?vista=a_confirmar" className={s.pendente} data-tom="warn">
                  <b>{num(d.elementos.a_confirmar)}</b> a confirmar no terreno
                </Link>
                <Link href="/projecto/pendentes?vista=na" className={s.pendente}>
                  <b>{num(d.elementos.na)}</b> N/A
                </Link>
              </div>
            </section>

            <div className={s.duasColunas}>
              <section className={s.bloco} aria-labelledby="t-sis">
                <header><h2 id="t-sis">Por sistema</h2><span className={s.sub}>clique para filtrar</span></header>
                <div className={s.sistemas}>
                  {d.por_sistema.map((x) => (
                    <button key={x.sistema || "sem"} type="button" className={s.sistema}
                            aria-pressed={sistema === x.sistema}
                            onClick={() => setSistema(sistema === x.sistema ? "" : x.sistema)}>
                      <span className={s.sisNome}>{x.nome}</span>
                      <span className={s.sisPct}>{pct(x.progresso, 2)}</span>
                      <Barra v={x.progresso} />
                      <span className={s.nota}>
                        {x.sitios} sítios · C {pct(x.cfg)} · M {pct(x.mon)} · T {pct(x.tst)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className={s.bloco} aria-labelledby="t-cat">
                <header><h2 id="t-cat">Montagem por tipo de elemento</h2><span className={s.sub}>pontos com dados no RTU</span></header>
                <ul className={s.categorias}>
                  {d.por_categoria.map((c) => (
                    <li key={c.categoria}>
                      <span className={s.catNome}>{c.nome}</span>
                      <span className={s.catTrilho} aria-hidden="true" style={{ width: `${(c.p / maxCat) * 100}%` }}>
                        <i style={{ width: `${c.progresso * 100}%` }} />
                      </span>
                      <span className={s.catValor}><b>{num(c.r)}</b> / {num(c.p)} · {pct(c.progresso)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <div className={s.filtros}>
              <input type="search" placeholder="Procurar sítio…" value={q} onChange={(e) => setQ(e.target.value)}
                     aria-label="Procurar sítio" />
              <select value={sistema} onChange={(e) => setSistema(e.target.value as Sistema)} aria-label="Sistema">
                <option value="">Todos os sistemas</option>
                {SISTEMAS.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
              </select>
              <select value={lote} onChange={(e) => setLote(e.target.value)} aria-label="Lote">
                <option value="">Todos os lotes</option>
                {LOTES.map((l) => <option key={l.id} value={l.id}>{l.titulo.split(" —")[0]}</option>)}
              </select>
              <select value={sit} onChange={(e) => setSit(e.target.value as Situacao)} aria-label="Situação">
                <option value="">Todas as situações</option>
                {(Object.keys(SITUACAO_NOME) as Situacao[]).map((k) => (
                  <option key={k} value={k}>{SIMBOLO[k]} {SITUACAO_NOME[k]}</option>
                ))}
              </select>
              {activos && (
                <button type="button" className={s.limpar}
                        onClick={() => { setSistema(""); setLote(""); setSit(""); setQ(""); }}>
                  Limpar filtros
                </button>
              )}
              <span className={s.contador}>{visiveis.length} de {d.por_sitio.length} sítios</span>
            </div>

            <section className={s.quadro}>
              {!visiveis.length ? (
                <p className={s.vazio}>Nenhum sítio corresponde aos filtros.</p>
              ) : (
                <div className={s.rolagem}>
                  <table className={s.tabela}>
                    <thead>
                      <tr>
                        <th>Sítio</th>
                        <th className={s.cCurta}>Lote</th>
                        <th className={s.cFase}>Configuração</th>
                        <th className={s.cFase}>Montagem</th>
                        <th className={s.cPontos}>Pontos</th>
                        <th className={s.cFase}>Testes</th>
                        <th className={s.cFase}>Estado global</th>
                        <th className={s.cPend}>No terreno</th>
                      </tr>
                    </thead>
                    {[...SISTEMAS.map((x) => ({ id: x.id as Sistema, nome: x.nome })), { id: "" as Sistema, nome: "Sem sistema" }]
                      .map((g) => {
                        const linhas = visiveis.filter((x) => x.sistema === g.id);
                        if (!linhas.length) return null;
                        const resumo = d.por_sistema.find((x) => x.sistema === g.id);
                        return (
                          <tbody key={g.id || "sem"}>
                            <tr className={s.linhaGrupo}>
                              <td colSpan={8}>
                                {g.nome}
                                {resumo && <span>{pct(resumo.progresso, 2)} · {resumo.sitios} sítios</span>}
                              </td>
                            </tr>
                            {linhas.map((x) => (
                              <tr key={x.id} className={s.linha} onClick={() => router.push(`/projecto/sitios/${x.id}`)}>
                                <td>
                                  <span className={s.tipo}>{x.tipo}</span>
                                  <Link href={`/projecto/sitios/${x.id}`} onClick={(e) => e.stopPropagation()}>{x.nome}</Link>
                                </td>
                                <td className={s.cCurta}>{x.lote ? x.lote.replace("L", "") : "—"}</td>
                                <td className={s.cFase}><Celula v={x.cfg} /></td>
                                <td className={s.cFase}><Celula v={x.mon} /></td>
                                <td className={s.cPontos}>{num(x.pontos.r)} / {num(x.pontos.p)}</td>
                                <td className={s.cFase}><Celula v={x.tst} /></td>
                                <td className={s.cFase}><Celula v={x.global} forte /></td>
                                <td className={s.cPend}>
                                  {x.por_instalar > 0 && <span className={s.marca} data-tom="crit" title="Elementos por instalar">{x.por_instalar} por instalar</span>}
                                  {x.a_confirmar > 0 && <span className={s.marca} data-tom="warn" title="Realizado a confirmar no terreno">{x.a_confirmar} a confirmar</span>}
                                  {!x.por_instalar && !x.a_confirmar && <span className={s.nota}>—</span>}
                                </td>
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
              <p>
                <b>Como é calculado.</b> Configuração e Testes = Σ Realizado ÷ Σ Previsto das actividades do sítio.
                Montagem = pontos de campo com dados a chegar ao RTU ÷ pontos previstos no sinóptico de instrumentação
                (inclui a qualidade da água; elementos N/A não contam). Estado global = média das três fases.
                Esta medida é a da equipa SCADA; a página <Link href="/painel">Estado RTU</Link> mantém o cálculo do Excel.
              </p>
            </footer>
          </>
        )}
      </main>
    </>
  );
}
