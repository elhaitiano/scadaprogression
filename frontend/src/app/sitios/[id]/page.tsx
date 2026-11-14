"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/components/AuthProvider";
import { api, ApiError } from "@/lib/api";
import {
  FASES, SIMBOLO, SITUACAO_NOME, pct, percentagemFase, situacao,
  type Fase, type LinhaPR, type SitioDetalhe,
} from "@/lib/estado";
import { dataCurta } from "@/lib/planeamento";
import s from "./sitio.module.css";

type Valores = Record<number, { previsto: number; realizado: number }>; // por id da linha P/R

const num = (v: string | number) => Number(v) || 0;

export default function PaginaSitio() {
  const { id } = useParams<{ id: string }>();
  const { utilizador } = useAuth();
  const podeR = utilizador?.perfil === "admin" || utilizador?.perfil === "tecnico";
  const podeP = utilizador?.perfil === "admin";

  const [sitio, setSitio] = useState<SitioDetalhe | null>(null);
  const [original, setOriginal] = useState<Valores>({});
  const [valores, setValores] = useState<Valores>({});
  const [erros, setErros] = useState<Record<number, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [aGuardar, setAGuardar] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const d = await api<SitioDetalhe>(`/sitios/${id}/`);
      const v: Valores = {};
      for (const l of d.actividades) v[l.id] = { previsto: num(l.previsto), realizado: num(l.realizado) };
      setSitio(d);
      setOriginal(v);
      setValores(v);
      setErros({});
    } catch (e) {
      setErro(e instanceof ApiError && e.status === 404 ? "Sítio não encontrado." : e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const alteradas = useMemo(
    () => Object.keys(valores).map(Number).filter((k) =>
      valores[k].previsto !== original[k]?.previsto || valores[k].realizado !== original[k]?.realizado),
    [valores, original],
  );

  // % recalculadas em directo, com os valores ainda não guardados
  const progresso = useMemo(() => {
    const por: Record<string, number> = {};
    for (const f of FASES) {
      const linhas = (sitio?.actividades ?? []).filter((l) => l.fase === f.id).map((l) => valores[l.id] ?? { previsto: 0, realizado: 0 });
      por[f.id] = percentagemFase(linhas);
    }
    por.global = (por.cfg + por.mon + por.tst) / 3;
    return por;
  }, [sitio, valores]);

  function mudar(linha: LinhaPR, campo: "previsto" | "realizado", texto: string) {
    const v = Math.max(0, Number(texto.replace(",", ".")) || 0);
    setValores((ant) => ({ ...ant, [linha.id]: { ...ant[linha.id], [campo]: v } }));
    setErros((e) => {
      const r = { ...e };
      delete r[linha.id];
      return r;
    });
    setGuardado(false);
  }

  async function guardar() {
    // validação local: R ≤ P (o backend valida o mesmo)
    const locais: Record<number, string> = {};
    for (const k of alteradas) {
      if (valores[k].realizado > valores[k].previsto) locais[k] = "O realizado não pode ultrapassar o previsto.";
    }
    setErros(locais);
    if (Object.keys(locais).length) return;

    setAGuardar(true);
    const falhas: Record<number, string> = {};
    for (const k of alteradas) {
      // o Técnico só pode enviar o realizado; o Administrador envia ambos
      const corpo = podeP ? valores[k] : { realizado: valores[k].realizado };
      try {
        await api(`/sitios-actividades/${k}/`, { method: "PATCH", body: JSON.stringify(corpo) });
      } catch (e) {
        falhas[k] = e instanceof Error ? e.message : String(e);
      }
    }
    setAGuardar(false);
    if (Object.keys(falhas).length) {
      setErros(falhas);
      return;
    }
    await carregar();
    setGuardado(true);
  }

  if (erro) {
    return (
      <>
        <Header />
        <main className={`wrap ${s.pagina}`}>
          <Link href="/painel" className={s.voltar}>← Estado RTU</Link>
          <p className={s.erro} role="alert">{erro}</p>
        </main>
      </>
    );
  }

  if (!sitio) {
    return (
      <>
        <Header />
        <main className={`wrap ${s.pagina}`}><p className={s.vazio}>A carregar o sítio…</p></main>
      </>
    );
  }

  const linhasDe = (f: Fase) => sitio.actividades.filter((l) => l.fase === f);
  const sitGlobal = situacao(progresso.global);

  return (
    <>
      <Header />
      <main className={`wrap ${s.pagina}`}>
        <Link href="/painel" className={s.voltar}>← Estado RTU</Link>

        <section className={s.cabecalho}>
          <div className={s.identidade}>
            <span className="eyebrow">{sitio.tipo_nome} · {sitio.lote.replace("L", "Lote ")}</span>
            <h1>{sitio.tipo} {sitio.nome}</h1>
            <dl className={s.ficha}>
              <div><dt>RTU (modelo)</dt><dd>{sitio.rtu_modelo || "—"}</dd></div>
              <div><dt>Ferramenta</dt><dd>{sitio.ferramenta || "—"}</dd></div>
              <div><dt>Entradas DI/AI</dt><dd>{sitio.entradas || "—"}</dd></div>
              {sitio.tipo_instalacao_nome && (
                <div><dt>Instalação</dt><dd>{sitio.tipo_instalacao_nome}{sitio.instalacao_detalhe && ` — ${sitio.instalacao_detalhe}`}</dd></div>
              )}
            </dl>
          </div>
          <div className={s.indicadores}>
            <div className={s.global} data-sit={sitGlobal}>
              <span>Estado global</span>
              <b>{pct(progresso.global)}</b>
              <small>{SIMBOLO[sitGlobal]} {SITUACAO_NOME[sitGlobal]}</small>
            </div>
            {FASES.map((f) => {
              const v = progresso[f.id];
              return (
                <div key={f.id} className={s.fase} data-sit={situacao(v)}>
                  <span>{f.curto}</span>
                  <b>{pct(v)}</b>
                  <i aria-hidden="true"><em style={{ width: `${v * 100}%` }} /></i>
                </div>
              );
            })}
          </div>
        </section>

        {!podeR && <p className={s.aviso}>Perfil Leitor: pode consultar, mas não alterar os valores.</p>}
        {podeR && !podeP && (
          <p className={s.aviso}>Pode actualizar o <b>R (realizado)</b>. O <b>P (previsto)</b> vem do sinóptico e só o Administrador o altera.</p>
        )}

        <div className={s.blocos}>
          {[...FASES.map((f) => ({ id: f.id as Fase, titulo: f.titulo, conta: true })),
            { id: "sds" as Fase, titulo: "4. Partilhar com SUEZ Digital Solutions", conta: false }].map((bloco) => {
            const linhas = linhasDe(bloco.id);
            if (!linhas.length) return null;
            const v = percentagemFase(linhas.map((l) => valores[l.id]));
            return (
              <section key={bloco.id} className={s.bloco}>
                <header>
                  <h2>{bloco.titulo}</h2>
                  {bloco.conta ? <span className={s.pctBloco} data-sit={situacao(v)}>{pct(v)}</span>
                               : <span className={s.naoConta}>não entra nas %</span>}
                </header>
                <table className={s.pr}>
                  <thead>
                    <tr><th>Actividade</th><th className={s.cNum}>P</th><th className={s.cNum}>R</th><th className={s.cBarra}>R ÷ P</th></tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => {
                      const val = valores[l.id];
                      const mudou = alteradas.includes(l.id);
                      const razao = val.previsto ? val.realizado / val.previsto : 0;
                      return (
                        <tr key={l.id} data-mudou={mudou} data-sem-p={val.previsto === 0}>
                          <td>
                            {l.actividade_nome}
                            {l.actualizado_por_nome && (
                              <small>actualizado por {l.actualizado_por_nome} em {dataCurta(l.actualizado_em.slice(0, 10))}</small>
                            )}
                            {erros[l.id] && <span className={s.erroLinha}>{erros[l.id]}</span>}
                          </td>
                          <td className={s.cNum}>
                            <input type="number" min={0} step={1} inputMode="decimal" value={val.previsto}
                                   disabled={!podeP || aGuardar} aria-label={`Previsto — ${l.actividade_nome}`}
                                   onChange={(e) => mudar(l, "previsto", e.target.value)} />
                          </td>
                          <td className={s.cNum}>
                            <input type="number" min={0} max={val.previsto} step={1} inputMode="decimal" value={val.realizado}
                                   disabled={!podeR || aGuardar || val.previsto === 0}
                                   aria-label={`Realizado — ${l.actividade_nome}`} aria-invalid={Boolean(erros[l.id])}
                                   onChange={(e) => mudar(l, "realizado", e.target.value)} />
                          </td>
                          <td className={s.cBarra}>
                            {val.previsto === 0 ? <span className={s.na}>não aplicável</span> : (
                              <span className={s.mini} data-sit={situacao(razao)}><i style={{ width: `${razao * 100}%` }} /></span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>

        <div className={s.extras}>
          <section className={s.bloco}>
            <header><h2>PLC do sítio</h2></header>
            {sitio.plcs.length ? (
              <ul className={s.lista}>
                {sitio.plcs.map((p) => (
                  <li key={p.id}>
                    <b>{p.designacao || "PLC"}</b> · {p.modelo_nome || "modelo por indicar"}
                    <span className={s.etiqueta} data-accao={p.accao}>{p.accao_nome}</span>
                    {p.accao === "substituir" && (
                      <small>→ {p.modelo_substituto_nome || "substituto por definir"} · {p.estado_substituicao_nome}
                        {p.motivo_substituicao && ` — ${p.motivo_substituicao}`}</small>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className={s.semDados}>Sem PLC registado.</p>}
          </section>

          <section className={s.bloco}>
            <header><h2>Obstáculos</h2></header>
            {sitio.obstaculos.length ? (
              <ul className={s.lista}>
                {sitio.obstaculos.map((o) => (
                  <li key={o.id} data-estado={o.estado}>
                    <span className={s.etiqueta} data-estado={o.estado}>{o.estado_nome}</span>
                    <b>{o.categoria_nome}</b>{o.entidade && ` · ${o.entidade}`} — {o.descricao}
                    {o.solucao && <small>Solução: {o.solucao}</small>}
                  </li>
                ))}
              </ul>
            ) : <p className={s.semDados}>Nenhum obstáculo registado.</p>}
          </section>

          <section className={s.bloco}>
            <header>
              <h2>Tarefas abertas</h2>
              <Link href="/planeamento" className={s.link}>Planeamento →</Link>
            </header>
            {sitio.tarefas_abertas.length ? (
              <ul className={s.lista}>
                {sitio.tarefas_abertas.map((t) => (
                  <li key={t.id}>
                    <b>{t.descricao}</b>
                    <small>{t.equipa_texto || "—"} · {dataCurta(t.inicio)} → {dataCurta(t.fim)} · {t.progresso}%</small>
                  </li>
                ))}
              </ul>
            ) : <p className={s.semDados}>Nenhuma tarefa aberta para este sítio.</p>}
          </section>
        </div>

        {podeR && (alteradas.length > 0 || guardado) && (
          <div className={s.barraGuardar} role="region" aria-label="Alterações por guardar">
            {alteradas.length ? (
              <>
                <span><b>{alteradas.length}</b> {alteradas.length === 1 ? "alteração" : "alterações"} por guardar</span>
                <button type="button" className="btn" onClick={() => { setValores(original); setErros({}); }} disabled={aGuardar}>
                  Descartar
                </button>
                <button type="button" className={s.btnGuardar} onClick={guardar} disabled={aGuardar}>
                  {aGuardar ? "A guardar…" : "Guardar"}
                </button>
              </>
            ) : (
              <span role="status">✔ Valores guardados.</span>
            )}
          </div>
        )}
      </main>
    </>
  );
}