"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/components/AuthProvider";
import { api, ApiError } from "@/lib/api";
import { pct, situacao, type SitioDetalhe } from "@/lib/estado";
import { lista, type RespostaLista } from "@/lib/planeamento";
import {
  ACCOES, CATEGORIAS, ESTADOS_FISICOS, montagem, situacaoElemento, type Elemento,
} from "@/lib/projecto";
import NovoElemento from "./NovoElemento";
import s from "./elementos.module.css";

type Rascunho = Partial<Pick<Elemento, "estado_fisico" | "concluidos" | "tag" | "notas" | "quantidade" | "aplicavel" | "motivo_na">>;
const CAMPOS_TECNICO = ["estado_fisico", "concluidos", "tag", "notas"] as const;

const NOME_SITUACAO = {
  na: "N/A", por_instalar: "Por instalar", concluido: "Concluído", parcial: "Parcial", sem_dados: "Sem dados no RTU",
} as const;

export default function PaginaElementosSitio() {
  const { id } = useParams<{ id: string }>();
  const { utilizador } = useAuth();
  const perfil = utilizador?.perfil;
  const podeEditar = perfil === "admin" || perfil === "tecnico";
  const admin = perfil === "admin";

  const [sitio, setSitio] = useState<SitioDetalhe | null>(null);
  const [els, setEls] = useState<Elemento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [rasc, setRasc] = useState<Record<number, Rascunho>>({});
  const [errosLinha, setErrosLinha] = useState<Record<number, string>>({});
  const [aGuardar, setAGuardar] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [filtro, setFiltro] = useState<"" | ReturnType<typeof situacaoElemento>>("");

  const carregar = useCallback(async () => {
    try {
      const [d, e] = await Promise.all([
        api<SitioDetalhe>(`/sitios/${id}/`),
        api<RespostaLista<Elemento>>(`/elementos/?sitio=${id}`),
      ]);
      setSitio(d);
      setEls(lista(e));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // elementos com as alterações por gravar aplicadas
  const actuais = useMemo(() => (els ?? []).map((e) => ({ ...e, ...rasc[e.id] })), [els, rasc]);
  const mon = montagem(actuais);
  const cfg = sitio?.progresso.cfg ?? 0;
  const tst = sitio?.progresso.tst ?? 0;
  const global = (cfg + mon.v + tst) / 3;
  const mudados = Object.keys(rasc).length;

  function alterar(e: Elemento, campos: Rascunho) {
    setRasc((r) => {
      const junto: Rascunho = { ...r[e.id], ...campos };
      // ao voltar a "por instalar" não pode haver pontos concluídos
      if (campos.estado_fisico === "por_instalar") junto.concluidos = 0;
      // só fica o que difere do valor gravado
      const limpo = Object.fromEntries(
        Object.entries(junto).filter(([k, v]) => e[k as keyof Elemento] !== v),
      ) as Rascunho;
      const n = { ...r };
      if (Object.keys(limpo).length) n[e.id] = limpo; else delete n[e.id];
      return n;
    });
    setErrosLinha((x) => {
      const n = { ...x };
      delete n[e.id];
      return n;
    });
  }

  function validar(e: Elemento): string | null {
    if (e.concluidos > e.quantidade) return `No máximo ${e.quantidade}.`;
    if (e.estado_fisico === "por_instalar" && e.concluidos > 0) return "Por instalar: não pode ter pontos concluídos.";
    if (!e.aplicavel && !e.motivo_na.trim()) return "Indique porque não se aplica.";
    if (e.quantidade < 1) return "A quantidade tem de ser pelo menos 1.";
    return null;
  }

  async function guardar() {
    const erros: Record<number, string> = {};
    for (const e of actuais) {
      if (rasc[e.id]) {
        const m = validar(e);
        if (m) erros[e.id] = m;
      }
    }
    if (Object.keys(erros).length) {
      setErrosLinha(erros);
      return;
    }
    setAGuardar(true);
    setAviso(null);
    const falhas: Record<number, string> = {};
    for (const [k, r] of Object.entries(rasc)) {
      const corpo = admin ? r : Object.fromEntries(Object.entries(r).filter(([c]) => (CAMPOS_TECNICO as readonly string[]).includes(c)));
      try {
        await api(`/elementos/${k}/`, { method: "PATCH", body: JSON.stringify(corpo) });
      } catch (e) {
        falhas[Number(k)] = e instanceof ApiError ? Object.values(e.campos ?? {}).flat().join(" ") || e.message : "Erro ao gravar.";
      }
    }
    setAGuardar(false);
    setErrosLinha(falhas);
    setRasc((r) => Object.fromEntries(Object.entries(r).filter(([k]) => falhas[Number(k)])));
    await carregar();
    if (!Object.keys(falhas).length) setAviso("Alterações gravadas.");
  }

  async function confirmar(e: Elemento) {
    try {
      await api(`/elementos/${e.id}/`, { method: "PATCH", body: JSON.stringify({ concluidos: e.concluidos }) });
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : String(x));
    }
  }

  async function eliminar(e: Elemento) {
    if (!window.confirm(`Eliminar o elemento "${e.nome}"? Deixa de contar no previsto deste sítio.`)) return;
    try {
      await api(`/elementos/${e.id}/`, { method: "DELETE" });
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : String(x));
    }
  }

  const porCategoria = useMemo(() => {
    const g: { cat: (typeof CATEGORIAS)[number]; linhas: Elemento[] }[] = [];
    for (const cat of CATEGORIAS) {
      const linhas = actuais.filter((e) => e.categoria === cat.id && (!filtro || situacaoElemento(e) === filtro));
      if (linhas.length) g.push({ cat, linhas });
    }
    return g;
  }, [actuais, filtro]);

  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of actuais) c[situacaoElemento(e)] = (c[situacaoElemento(e)] ?? 0) + 1;
    return c;
  }, [actuais]);

  const sistemaNome = (sitio as (SitioDetalhe & { sistema_nome?: string }) | null)?.sistema_nome;

  return (
    <>
      <Header />
      <main className={`wrap ${s.pagina}`}>
        <Link href="/projecto" className={s.voltar}>← Progresso do projecto</Link>

        {erro && <p className={s.erro} role="alert">{erro}</p>}
        {!sitio && !erro && <p className={s.vazio}>A carregar…</p>}

        {sitio && els && (
          <>
            <div className={s.cabecalho}>
              <div>
                <span className="eyebrow">{sitio.tipo_nome}{sitio.lote && ` · Lote ${sitio.lote.replace("L", "")}`}{sistemaNome && ` · ${sistemaNome}`}</span>
                <h1>{sitio.tipo} {sitio.nome}</h1>
                <p className={s.sub}>
                  {els.length} elementos de campo · {mon.r} de {mon.p} pontos com dados no RTU ·{" "}
                  <Link href={`/sitios/${sitio.id}`}>P/R de Configuração e Testes</Link>
                </p>
              </div>
              <div className={s.indicadores}>
                <div className={s.global} data-sit={situacao(global)}><span>Estado global</span><b>{pct(global)}</b></div>
                {([["Configuração", cfg], ["Montagem", mon.v], ["Testes", tst]] as const).map(([n, v]) => (
                  <div key={n} className={s.fase} data-sit={situacao(v)}>
                    <span>{n}</span><b>{pct(v)}</b><i><em style={{ width: `${v * 100}%` }} /></i>
                  </div>
                ))}
              </div>
            </div>

            <div className={s.barraFiltros}>
              <button type="button" aria-pressed={filtro === ""} onClick={() => setFiltro("")}>Todos <b>{els.length}</b></button>
              {(Object.keys(NOME_SITUACAO) as (keyof typeof NOME_SITUACAO)[]).filter((k) => contagem[k]).map((k) => (
                <button key={k} type="button" data-sit={k} aria-pressed={filtro === k}
                        onClick={() => setFiltro(filtro === k ? "" : k)}>
                  {NOME_SITUACAO[k]} <b>{contagem[k]}</b>
                </button>
              ))}
              {admin && <button type="button" className={s.acrescentar} onClick={() => setNovo(true)}>+ Elemento</button>}
            </div>

            {!podeEditar && <p className={s.aviso}>Perfil de leitura: pode consultar mas não alterar.</p>}
            {perfil === "tecnico" && (
              <p className={s.aviso}>
                Pode actualizar o estado físico, os pontos concluídos, a TAG e as notas. Acrescentar, eliminar,
                quantidade e N/A são do Administrador.
              </p>
            )}

            {!porCategoria.length && <p className={s.vazio}>Nenhum elemento nesta situação.</p>}

            {porCategoria.map(({ cat, linhas }) => {
              const m = montagem(linhas);
              return (
                <section key={cat.id} className={s.bloco}>
                  <header>
                    <h2>{cat.nome}</h2>
                    <span className={s.pctBloco} data-sit={situacao(m.v)}>{m.r} / {m.p} · {pct(m.v)}</span>
                  </header>
                  <table className={s.tabela}>
                    <thead>
                      <tr>
                        <th>Elemento</th>
                        <th className={s.cAccao}>Acção prevista</th>
                        <th className={s.cEstado}>Estado físico</th>
                        <th className={s.cPontos}>Pontos com dados</th>
                        <th className={s.cTag}>TAG</th>
                        <th className={s.cSit}>Situação</th>
                        {admin && <th className={s.cAdmin}>Previsto</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.map((e) => {
                        const orig = els.find((x) => x.id === e.id)!;
                        const sit = situacaoElemento(e);
                        return (
                          <tr key={e.id} data-sit={sit} data-mudou={Boolean(rasc[e.id])}>
                            <td>
                              <b>{e.nome}</b>
                              <small>
                                {[e.grupo, e.agua && `água ${e.agua}`, e.origem === "manual" && "acrescentado no terreno",
                                  e.actualizado_por_nome && `actualizado por ${e.actualizado_por_nome}`]
                                  .filter(Boolean).join(" · ")}
                              </small>
                              {!e.aplicavel && e.motivo_na && <small className={s.motivo}>N/A: {e.motivo_na}</small>}
                              {errosLinha[e.id] && <span className={s.erroLinha}>{errosLinha[e.id]}</span>}
                            </td>
                            <td className={s.cAccao}>
                              <span className={s.etiqueta} data-accao={e.accao_prevista}>
                                {ACCOES.find((a) => a.id === e.accao_prevista)?.nome}
                              </span>
                            </td>
                            <td className={s.cEstado}>
                              <select value={e.estado_fisico} disabled={!podeEditar || !e.aplicavel}
                                      aria-label={`Estado físico de ${e.nome}`}
                                      onChange={(x) => alterar(orig, { estado_fisico: x.target.value as Elemento["estado_fisico"] })}>
                                {ESTADOS_FISICOS.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                              </select>
                            </td>
                            <td className={s.cPontos}>
                              <span className={s.passo}>
                                <button type="button" aria-label="Menos um"
                                        disabled={!podeEditar || !e.aplicavel || e.concluidos <= 0}
                                        onClick={() => alterar(orig, { concluidos: e.concluidos - 1 })}>−</button>
                                <output aria-label={`Pontos concluídos de ${e.nome}`}>{e.concluidos} / {e.quantidade}</output>
                                <button type="button" aria-label="Mais um"
                                        disabled={!podeEditar || !e.aplicavel || e.estado_fisico === "por_instalar" || e.concluidos >= e.quantidade}
                                        onClick={() => alterar(orig, { concluidos: e.concluidos + 1 })}>+</button>
                              </span>
                              {podeEditar && e.aplicavel && e.concluidos < e.quantidade && (
                                <button type="button" className={s.link}
                                        onClick={() => alterar(orig, {
                                          estado_fisico: e.estado_fisico === "por_instalar"
                                            ? (e.accao_prevista === "substituir" ? "substituido" : "instalado") : e.estado_fisico,
                                          concluidos: e.quantidade,
                                        })}>
                                  tudo concluído
                                </button>
                              )}
                            </td>
                            <td className={s.cTag}>
                              <input type="text" value={e.tag} disabled={!podeEditar} placeholder="—"
                                     aria-label={`TAG de ${e.nome}`}
                                     onChange={(x) => alterar(orig, { tag: x.target.value })} />
                            </td>
                            <td className={s.cSit}>
                              <span className={s.situacao} data-sit={sit}>{NOME_SITUACAO[sit]}</span>
                              {e.a_confirmar && (
                                <span className={s.confirmar}>
                                  a confirmar
                                  {podeEditar && !rasc[e.id] && (
                                    <button type="button" className={s.link} onClick={() => confirmar(e)}
                                            title="Verificado no terreno: o valor está certo">confirmar</button>
                                  )}
                                </span>
                              )}
                            </td>
                            {admin && (
                              <td className={s.cAdmin}>
                                <label className={s.qtd}>
                                  Qtd.
                                  <input type="number" min={1} value={e.quantidade} aria-label={`Quantidade de ${e.nome}`}
                                         onChange={(x) => alterar(orig, { quantidade: Math.max(1, Number(x.target.value) || 1) })} />
                                </label>
                                <label className={s.na}>
                                  <input type="checkbox" checked={!e.aplicavel}
                                         onChange={(x) => alterar(orig, { aplicavel: !x.target.checked })} /> N/A
                                </label>
                                {!e.aplicavel && (
                                  <input type="text" className={s.motivoInput} value={e.motivo_na} placeholder="Motivo N/A"
                                         aria-label={`Motivo N/A de ${e.nome}`}
                                         onChange={(x) => alterar(orig, { motivo_na: x.target.value })} />
                                )}
                                <button type="button" className={s.eliminar} onClick={() => eliminar(orig)}>Eliminar</button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              );
            })}

            {novo && (
              <NovoElemento sitio={sitio.id} grupos={[...new Set(els.map((e) => e.grupo).filter(Boolean))]}
                            onFechar={() => setNovo(false)}
                            onCriado={async () => { setNovo(false); await carregar(); }} />
            )}

            {aviso && !mudados && <p className={s.ok} role="status">{aviso}</p>}

            {mudados > 0 && (
              <div className={s.barraGuardar} role="region" aria-label="Alterações por gravar">
                <span>{mudados} {mudados === 1 ? "elemento alterado" : "elementos alterados"} · Montagem {pct(mon.v)}</span>
                <button type="button" className="btn" onClick={() => { setRasc({}); setErrosLinha({}); }} disabled={aGuardar}>
                  Anular
                </button>
                <button type="button" className={s.btnGuardar} onClick={guardar} disabled={aGuardar}>
                  {aGuardar ? "A gravar…" : "Gravar"}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
