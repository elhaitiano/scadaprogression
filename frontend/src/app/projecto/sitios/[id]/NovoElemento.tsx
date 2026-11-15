"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { ACCOES, CATEGORIAS, ESTADOS_FISICOS, type Accao, type Categoria, type EstadoFisico } from "@/lib/projecto";
import s from "./elementos.module.css";

interface Props {
  sitio: number;
  grupos: string[];
  onFechar: () => void;
  onCriado: () => void;
}

/** Acrescentar um elemento que falta no sinóptico (só Administrador). */
export default function NovoElemento({ sitio, grupos, onFechar, onCriado }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState<Categoria>("bat");
  const [agua, setAgua] = useState<"" | "bruta" | "tratada">("");
  const [grupo, setGrupo] = useState(grupos[0] ?? "");
  const [quantidade, setQuantidade] = useState(1);
  const [accao, setAccao] = useState<Accao>("ligar");
  const [estado, setEstado] = useState<EstadoFisico>("existente");
  const [concluidos, setConcluidos] = useState(0);
  const [notas, setNotas] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aGravar, setAGravar] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function gravar(ev: React.SubmitEvent<HTMLFormElement>) {
    ev.preventDefault();
    setErro(null);
    if (!nome.trim()) return setErro("Indique o nome do elemento.");
    setAGravar(true);
    try {
      await api("/elementos/", {
        method: "POST",
        body: JSON.stringify({
          sitio, nome: nome.trim(), categoria, agua, grupo, quantidade, accao_prevista: accao,
          estado_fisico: estado, concluidos: estado === "por_instalar" ? 0 : concluidos, notas, ordem: 999,
        }),
      });
      onCriado();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível gravar.");
    } finally {
      setAGravar(false);
    }
  }

  return (
    <dialog ref={ref} className={s.dialogo} onClose={onFechar} aria-labelledby="t-novo">
      <form onSubmit={gravar}>
        <h2 id="t-novo">Acrescentar elemento</h2>
        <p className={s.sub}>Para um elemento que existe no terreno e falta no sinóptico. Conta no previsto do sítio.</p>

        <label className="f">Nome
          <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus
                 placeholder="Ex.: Bomba 6 água tratada" />
        </label>
        <div className={s.duas}>
          <label className="f">Tipo
            <select value={categoria} onChange={(e) => setCategoria(e.target.value as Categoria)}>
              {CATEGORIAS.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label className="f">Água
            <select value={agua} onChange={(e) => setAgua(e.target.value as typeof agua)}>
              <option value="">—</option>
              <option value="bruta">Água bruta</option>
              <option value="tratada">Água tratada</option>
            </select>
          </label>
        </div>
        <div className={s.duas}>
          {grupos.length > 0 && (
            <label className="f">Fase / grupo
              <select value={grupo} onChange={(e) => setGrupo(e.target.value)}>
                <option value="">—</option>
                {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
          )}
          <label className="f">Quantidade (pontos)
            <input type="number" min={1} value={quantidade}
                   onChange={(e) => setQuantidade(Math.max(1, Number(e.target.value) || 1))} />
          </label>
        </div>
        <div className={s.duas}>
          <label className="f">Acção prevista
            <select value={accao} onChange={(e) => setAccao(e.target.value as Accao)}>
              {ACCOES.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
          </label>
          <label className="f">Estado físico
            <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoFisico)}>
              {ESTADOS_FISICOS.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
          </label>
        </div>
        <label className="f">Pontos já com dados no RTU
          <input type="number" min={0} max={quantidade} value={estado === "por_instalar" ? 0 : concluidos}
                 disabled={estado === "por_instalar"}
                 onChange={(e) => setConcluidos(Math.min(quantidade, Math.max(0, Number(e.target.value) || 0)))} />
        </label>
        <label className="f">Notas
          <textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
        </label>

        {erro && <p className={s.erro} role="alert">{erro}</p>}
        <div className={s.accoesDialogo}>
          <button type="button" className="btn" onClick={() => ref.current?.close()}>Cancelar</button>
          <button type="submit" className={s.btnGuardar} disabled={aGravar}>{aGravar ? "A gravar…" : "Acrescentar"}</button>
        </div>
      </form>
    </dialog>
  );
}
