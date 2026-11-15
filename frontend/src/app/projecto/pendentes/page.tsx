"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { api } from "@/lib/api";
import { lista, type RespostaLista } from "@/lib/planeamento";
import {
  CATEGORIAS, SISTEMAS, VISTAS, csv, guardarBlob, num, situacaoElemento,
  type Categoria, type Elemento, type Sistema, type Vista,
} from "@/lib/projecto";
import s from "../projecto.module.css";
import p from "./pendentes.module.css";

const NOME_SIT = {
  na: "N/A", por_instalar: "Por instalar", concluido: "Concluído", parcial: "Parcial", sem_dados: "Sem dados no RTU",
} as const;

function Conteudo() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pedida = params.get("vista") ?? "falta_instalar";
  const vista = (pedida === "todos" ? "" : pedida) as Vista;
  const sistema = (params.get("sistema") ?? "") as Sistema;
  const categoria = (params.get("categoria") ?? "") as "" | Categoria;
  const [q, setQ] = useState(params.get("q") ?? "");
  const [els, setEls] = useState<Elemento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function mudar(chave: string, valor: string) {
    const n = new URLSearchParams(params.toString());
    if (valor) n.set(chave, valor); else n.delete(chave);
    router.replace(`${pathname}?${n.toString()}`, { scroll: false });
  }

  useEffect(() => {
    let cancelado = false;
    setEls(null);
    const n = new URLSearchParams();
    if (vista) n.set("vista", vista);
    if (sistema) n.set("sistema", sistema);
    if (categoria) n.set("categoria", categoria);
    api<RespostaLista<Elemento>>(`/elementos/?${n.toString()}`)
      .then((r) => !cancelado && setEls(lista(r)))
      .catch((e) => !cancelado && setErro(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelado = true;
    };
  }, [vista, sistema, categoria]);

  const visiveis = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (els ?? []).filter((e) => !t || `${e.sitio_nome} ${e.nome} ${e.tag}`.toLowerCase().includes(t));
  }, [els, q]);

  // agrupado por sítio, pela ordem que vem da API (sistema, sítio)
  const porSitio = useMemo(() => {
    const m = new Map<number, { nome: string; linhas: Elemento[] }>();
    for (const e of visiveis) {
      if (!m.has(e.sitio)) m.set(e.sitio, { nome: e.sitio_nome, linhas: [] });
      m.get(e.sitio)!.linhas.push(e);
    }
    return [...m.entries()];
  }, [visiveis]);

  const pontos = visiveis.reduce((a, e) => a + (e.quantidade - e.concluidos), 0);
  const info = VISTAS.find((v) => v.id === vista);

  function exportar() {
    const cab = ["Sítio", "Fase/grupo", "Tipo", "Água", "Elemento", "TAG", "Acção prevista", "Estado físico",
                 "Quantidade", "Pontos com dados", "Situação", "A confirmar", "Motivo N/A", "Notas"];
    const linhas = visiveis.map((e) => [
      e.sitio_nome, e.grupo, e.categoria_nome, e.agua, e.nome, e.tag, e.accao_nome, e.estado_fisico_nome,
      e.quantidade, e.concluidos, NOME_SIT[situacaoElemento(e)], e.a_confirmar ? "Sim" : "", e.motivo_na, e.notas,
    ]);
    const hoje = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    guardarBlob(csv([cab, ...linhas]), `ProAgua_Elementos_${vista || "todos"}_${hoje}.csv`);
  }

  return (
    <main className={`wrap ${s.pagina}`}>
      <Link href="/projecto" className={p.voltar}>← Progresso do projecto</Link>
      <div className={s.topo}>
        <div>
          <span className="eyebrow">Elementos de campo do sinóptico</span>
          <h1>Pendentes no terreno</h1>
          <p className={s.sub}>{info?.ajuda ?? "Todos os elementos"}</p>
        </div>
        <button type="button" className="btn" onClick={exportar} disabled={!visiveis.length}>Exportar CSV</button>
      </div>

      <div className={p.vistas} role="tablist" aria-label="Vista">
        {VISTAS.map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={vista === v.id} title={v.ajuda}
                  onClick={() => mudar("vista", v.id)}>{v.nome}</button>
        ))}
        <button type="button" role="tab" aria-selected={vista === ""} onClick={() => mudar("vista", "todos")}>Todos</button>
      </div>

      <div className={s.filtros}>
        <input type="search" placeholder="Procurar sítio, elemento, TAG…" value={q} onChange={(e) => setQ(e.target.value)}
               aria-label="Procurar" />
        <select value={sistema} onChange={(e) => mudar("sistema", e.target.value)} aria-label="Sistema">
          <option value="">Todos os sistemas</option>
          {SISTEMAS.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </select>
        <select value={categoria} onChange={(e) => mudar("categoria", e.target.value)} aria-label="Tipo de elemento">
          <option value="">Todos os tipos</option>
          {CATEGORIAS.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        {els && (
          <span className={s.contador}>
            {num(visiveis.length)} elementos · {porSitio.length} sítios
            {vista !== "concluidos" && vista !== "na" && ` · ${num(pontos)} pontos em falta`}
          </span>
        )}
      </div>

      {erro && <p className={s.erro} role="alert">{erro}</p>}

      <section className={s.quadro} aria-busy={els === null}>
        {els === null ? (
          <p className={s.vazio}>A carregar…</p>
        ) : !visiveis.length ? (
          <p className={s.vazio}>Nada nesta vista.</p>
        ) : (
          <div className={s.rolagem}>
            <table className={s.tabela}>
              <thead>
                <tr>
                  <th>Elemento</th>
                  <th>Tipo</th>
                  <th>Acção prevista</th>
                  <th>Estado físico</th>
                  <th className={s.cPontos}>Pontos</th>
                  <th>TAG</th>
                </tr>
              </thead>
              {porSitio.map(([id, g]) => (
                <tbody key={id}>
                  <tr className={s.linhaGrupo}>
                    <td colSpan={6}>
                      <Link href={`/projecto/sitios/${id}`} className={p.sitio}>{g.nome}</Link>
                      <span>{g.linhas.length} elementos</span>
                    </td>
                  </tr>
                  {g.linhas.map((e) => (
                    <tr key={e.id} className={s.linha} onClick={() => router.push(`/projecto/sitios/${e.sitio}`)}>
                      <td>
                        <b>{e.nome}</b>
                        {(e.grupo || e.a_confirmar || e.motivo_na) && (
                          <small className={p.detalhe}>
                            {[e.grupo, e.a_confirmar && "a confirmar", e.motivo_na && `N/A: ${e.motivo_na}`].filter(Boolean).join(" · ")}
                          </small>
                        )}
                      </td>
                      <td>{e.categoria_nome}</td>
                      <td><span className={p.accao} data-accao={e.accao_prevista}>{e.accao_nome}</span></td>
                      <td>{e.estado_fisico_nome}</td>
                      <td className={s.cPontos}>{e.concluidos} / {e.quantidade}</td>
                      <td>{e.tag || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default function PaginaPendentes() {
  return (
    <>
      <Header />
      <Suspense fallback={<p className={s.vazio}>A carregar…</p>}>
        <Conteudo />
      </Suspense>
    </>
  );
}
