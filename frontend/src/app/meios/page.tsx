"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/components/AuthProvider";
import { api, ApiError } from "@/lib/api";
import {
  ESTADOS_PEDIDO, TIPOS_MEIO, type Meio, type PedidoMeio, type TipoMeio,
} from "@/lib/meios";
import { lista, type Pessoa, type RespostaLista } from "@/lib/planeamento";
import DialogoMeio from "./DialogoMeio";
import s from "./meios.module.css";

const fmt = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-PT") : "—");

function erroTexto(e: unknown): string {
  if (e instanceof ApiError) {
    const c = Object.values(e.campos ?? {}).flat();
    return c.length ? c.join(" ") : e.message;
  }
  return "Não foi possível concluir.";
}

// ---------------------------------------------------------------- parque

function Parque({ podeEditar, podeEliminar, pessoas }: { podeEditar: boolean; podeEliminar: boolean; pessoas: Pessoa[] }) {
  const [meios, setMeios] = useState<Meio[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tipo, setTipo] = useState<"" | TipoMeio>("");
  const [q, setQ] = useState("");
  const [inactivos, setInactivos] = useState(false);
  const [aberto, setAberto] = useState<{ meio: Meio | null } | null>(null);

  const carregar = useCallback(() => {
    api<Meio[]>(`/meios/${inactivos ? "" : "?activo=1"}`)
      .then((r) => { setMeios(r); setErro(null); })
      .catch((e) => setErro(erroTexto(e)));
  }, [inactivos]);

  useEffect(() => { carregar(); }, [carregar]);

  const visiveis = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (meios ?? []).filter((m) => (!tipo || m.tipo === tipo)
      && (!t || `${m.codigo} ${m.nome} ${m.matricula} ${m.marca} ${m.modelo} ${m.po_referencia}`.toLowerCase().includes(t)));
  }, [meios, tipo, q]);

  const resumo = useMemo(() => {
    const act = (meios ?? []).filter((m) => m.activo);
    return {
      total: act.length,
      ocupados: act.filter((m) => m.hoje.length).length,
      parados: act.filter((m) => m.estado === "manutencao" || m.estado === "avariado").length,
    };
  }, [meios]);

  return (
    <>
      <div className={s.kpis}>
        <div><b>{resumo.total}</b> no parque</div>
        <div><b>{resumo.total - resumo.ocupados - resumo.parados}</b> livres hoje</div>
        <div><b>{resumo.ocupados}</b> afectados hoje</div>
        <div data-tom="warn"><b>{resumo.parados}</b> em manutenção / avariados</div>
      </div>

      <div className={s.filtros}>
        <input type="search" placeholder="Procurar código, nome, matrícula, PO…" value={q} onChange={(e) => setQ(e.target.value)}
               aria-label="Procurar" />
        <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoMeio)} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {TIPOS_MEIO.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
        <label className={s.check}>
          <input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} /> Mostrar os que saíram do parque
        </label>
        {podeEditar && <button type="button" className={s.btnNovo} onClick={() => setAberto({ meio: null })}>+ Meio</button>}
      </div>

      {erro && <p className={s.erro} role="alert">{erro}</p>}
      <div className={s.quadro}>
        {meios === null ? <p className={s.vazio}>A carregar…</p> : !visiveis.length ? (
          <p className={s.vazio}>{meios.length ? "Nenhum meio corresponde aos filtros." : "Ainda não há meios no parque. Comece por acrescentar as viaturas e os instrumentos."}</p>
        ) : (
          <table className={s.tabela}>
            <thead>
              <tr><th>Código</th><th>Meio</th><th>Tipo</th><th>Matrícula / série</th><th>Estado</th><th>Responsável</th><th>Hoje</th></tr>
            </thead>
            <tbody>
              {visiveis.map((m) => (
                <tr key={m.id} onClick={() => setAberto({ meio: m })} data-activo={m.activo}>
                  <td><b>{m.codigo}</b></td>
                  <td>{m.nome}<small>{[m.marca, m.modelo, m.propriedade !== "proprio" ? m.propriedade_nome : "", m.po_referencia && `PO ${m.po_referencia}`].filter(Boolean).join(" · ")}</small></td>
                  <td><span className={s.tipo} data-tipo={m.tipo}>{m.tipo_nome}</span></td>
                  <td>{m.matricula || m.numero_serie || "—"}</td>
                  <td><span className={s.estado} data-estado={m.activo ? m.estado : "inactivo"}>{m.activo ? m.estado_nome : "Fora do parque"}</span></td>
                  <td>{m.responsavel_nome ?? "—"}</td>
                  <td>
                    {m.hoje.length ? m.hoje.map((h) => (
                      <span key={h.id} className={s.hoje}>{h.texto}<small>{h.periodo}{h.pessoa ? ` · ${h.pessoa}` : ""}</small></span>
                    )) : m.activo && (m.estado === "operacional" || m.estado === "limitado") ? <span className={s.livre}>Livre</span> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {aberto && (
        <DialogoMeio key={aberto.meio?.id ?? "novo"} meio={aberto.meio} podeEditar={podeEditar} podeEliminar={podeEliminar}
                     pessoas={pessoas} onFechar={() => setAberto(null)}
                     onGuardado={() => { setAberto(null); carregar(); }} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- pedidos externos

function CartaoPedido({ p, podeEditar, onMudou }: { p: PedidoMeio; podeEditar: boolean; onMudou: () => void }) {
  const [po, setPo] = useState(p.po_referencia);
  const [fornecedor, setFornecedor] = useState(p.fornecedor);
  const [modo, setModo] = useState<"" | "chegou" | "devolvido">("");
  const [codigo, setCodigo] = useState(`ALUG-${p.po_referencia}`);
  const [nome, setNome] = useState(p.descricao);
  const [matricula, setMatricula] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const aberto = p.estado === "pedido" || p.estado === "encomendado";
  const mudouPo = po.trim().toUpperCase() !== p.po_referencia || fornecedor.trim() !== p.fornecedor;

  async function correr(caminho: string, corpo: object, metodo = "POST") {
    setErro(null);
    try {
      const r = await api<PedidoMeio>(caminho, { method: metodo, body: JSON.stringify(corpo) });
      if (r.aviso) setAviso(r.aviso);
      setModo("");
      onMudou();
    } catch (e) {
      setErro(erroTexto(e));
    }
  }

  return (
    <li className={s.pedido} data-estado={p.estado}>
      <div className={s.pedidoCab}>
        <span className={s.estadoPedido} data-estado={p.estado}>{p.estado_nome}</span>
        <b>{p.descricao}</b>
        <span className={s.tipo} data-tipo={p.tipo}>{p.tipo_nome}</span>
        <span className={s.periodo}>{fmt(p.data_inicio)} → {fmt(p.data_fim)}</span>
      </div>
      <p className={s.pedidoInfo}>
        {[p.onde, p.pessoa_nome && `para ${p.pessoa_nome}`, p.solicitado_por_nome && `pedido por ${p.solicitado_por_nome}`,
          p.meio_nome && `meio: ${p.meio_nome}`, p.chegou_em && `chegou ${fmt(p.chegou_em)}`,
          p.devolvido_em && `devolvido ${fmt(p.devolvido_em)}`].filter(Boolean).join(" · ")}
      </p>

      {aberto && podeEditar ? (
        <div className={s.linhaPo}>
          <label>Referência da PO <input type="text" value={po} onChange={(e) => setPo(e.target.value)} placeholder="ex.: 4500123456" /></label>
          <label>Fornecedor <input type="text" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} /></label>
          {mudouPo && (
            <button type="button" className={s.btnNovo}
                    onClick={() => correr(`/pedidos-meios/${p.id}/`, { po_referencia: po, fornecedor }, "PATCH")}>
              Guardar PO
            </button>
          )}
        </div>
      ) : (p.po_referencia || p.fornecedor) && (
        <p className={s.pedidoInfo}>{p.po_referencia && <>PO <b>{p.po_referencia}</b></>}{p.fornecedor && ` · ${p.fornecedor}`}</p>
      )}

      {podeEditar && modo === "chegou" && (
        <div className={s.linhaPo}>
          <label>Código no parque <input type="text" value={codigo} onChange={(e) => setCodigo(e.target.value)} /></label>
          <label>Nome <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
          <label>Matrícula <input type="text" value={matricula} onChange={(e) => setMatricula(e.target.value)} /></label>
          <label>Chegou em <input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
          <button type="button" className={s.btnNovo}
                  onClick={() => correr(`/pedidos-meios/${p.id}/chegou/`, { codigo, nome, matricula, data })}>Confirmar chegada</button>
          <button type="button" className="btn" onClick={() => setModo("")}>Cancelar</button>
        </div>
      )}
      {podeEditar && modo === "devolvido" && (
        <div className={s.linhaPo}>
          <label>Devolvido em <input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
          <button type="button" className={s.btnNovo} onClick={() => correr(`/pedidos-meios/${p.id}/devolvido/`, { data })}>Confirmar devolução</button>
          <button type="button" className="btn" onClick={() => setModo("")}>Cancelar</button>
        </div>
      )}

      {podeEditar && !modo && (
        <div className={s.accoesPedido}>
          {p.estado === "encomendado" && !mudouPo && (
            <button type="button" className={s.btnNovo} onClick={() => { setCodigo(`ALUG-${p.po_referencia}`); setModo("chegou"); }}>Chegou</button>
          )}
          {p.estado === "pedido" && <span className={s.dica}>Indique a referência da PO para poder registar a chegada.</span>}
          {p.estado === "chegou" && <button type="button" className={s.btnNovo} onClick={() => setModo("devolvido")}>Devolvido</button>}
          {aberto && (
            <button type="button" className={s.btnAnular}
                    onClick={() => window.confirm("Anular este pedido?") && correr(`/pedidos-meios/${p.id}/anular/`, {})}>
              Anular
            </button>
          )}
        </div>
      )}
      {aviso && <p className={s.aviso}>{aviso}</p>}
      {erro && <p className={s.erro} role="alert">{erro}</p>}
    </li>
  );
}

function Pedidos({ podeEditar }: { podeEditar: boolean }) {
  const [pedidos, setPedidos] = useState<PedidoMeio[] | null>(null);
  const [todos, setTodos] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<PedidoMeio[]>(`/pedidos-meios/${todos ? "" : "?abertos=1"}`)
      .then((r) => { setPedidos(r); setErro(null); })
      .catch((e) => setErro(erroTexto(e)));
  }, [todos]);

  useEffect(() => { carregar(); }, [carregar]);

  const contagem = (e: string) => (pedidos ?? []).filter((p) => p.estado === e).length;

  return (
    <>
      <p className={s.explica}>
        Quando não há nenhum meio disponível no parque, pede-se fora. A compra ou o aluguer seguem o processo normal
        (PR/PO); aqui registamos só a <b>referência da PO</b>, a chegada e a devolução. Ao chegar, o meio entra no parque
        como alugado e fica afectado à tarefa ou à visita que o pediu.
      </p>
      <div className={s.filtros}>
        <div className={s.kpisLinha}>
          {ESTADOS_PEDIDO.filter((e) => todos || ["pedido", "encomendado", "chegou"].includes(e.id)).map((e) => (
            <span key={e.id} className={s.estadoPedido} data-estado={e.id}>{e.nome}: {contagem(e.id)}</span>
          ))}
        </div>
        <label className={s.check}>
          <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} /> Incluir devolvidos e anulados
        </label>
      </div>
      {erro && <p className={s.erro} role="alert">{erro}</p>}
      {pedidos === null ? <p className={s.vazio}>A carregar…</p> : !pedidos.length ? (
        <p className={s.vazio}>Nenhum pedido externo {todos ? "" : "em curso"}. Os pedidos fazem-se a partir de uma tarefa ou de uma visita, na secção «Meios».</p>
      ) : (
        <ul className={s.pedidos}>
          {pedidos.map((p) => <CartaoPedido key={`${p.id}-${p.estado}-${p.po_referencia}`} p={p} podeEditar={podeEditar} onMudou={carregar} />)}
        </ul>
      )}
    </>
  );
}

// ---------------------------------------------------------------- página

function Conteudo() {
  const { utilizador } = useAuth();
  const podeEditar = utilizador?.perfil === "admin" || utilizador?.perfil === "tecnico";
  const podeEliminar = utilizador?.perfil === "admin";
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const aba = params.get("aba") === "pedidos" ? "pedidos" : "parque";
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);

  useEffect(() => {
    api<RespostaLista<Pessoa>>("/pessoas/")
      .then((r) => setPessoas([...lista(r)].sort((a, b) => a.nome.localeCompare(b.nome, "pt"))))
      .catch(() => setPessoas([]));
  }, []);

  return (
    <main className={`wrap ${s.pagina}`}>
      <div className={s.topo}>
        <div>
          <span className="eyebrow">Viaturas · ferramentas e instrumentos · equipamento pesado</span>
          <h1>Meios</h1>
        </div>
      </div>
      <div className={s.abas} role="tablist">
        <button type="button" role="tab" aria-selected={aba === "parque"} onClick={() => router.replace(pathname)}>Parque</button>
        <button type="button" role="tab" aria-selected={aba === "pedidos"} onClick={() => router.replace(`${pathname}?aba=pedidos`)}>Pedidos externos</button>
      </div>
      {aba === "parque"
        ? <Parque podeEditar={podeEditar} podeEliminar={podeEliminar} pessoas={pessoas} />
        : <Pedidos podeEditar={podeEditar} />}
      <p className={s.nota}>
        O material (cabos, sensores, consumíveis) é gerido no armazém e não entra aqui. Para afectar um meio, abra a
        tarefa no Planeamento ou a visita na Agenda.
      </p>
    </main>
  );
}

export default function PaginaMeios() {
  return (
    <>
      <Header />
      <Suspense fallback={<p style={{ padding: 40, textAlign: "center" }}>A carregar…</p>}>
        <Conteudo />
      </Suspense>
    </>
  );
}
