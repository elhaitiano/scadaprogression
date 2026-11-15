"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Ocupacao } from "@/lib/meios";

interface Opcoes {
  desde: string;
  ate?: string;
  horaInicio?: string | null;
  horaFim?: string | null;
  excluirTarefa?: number;
  excluirEvento?: number;
}

/** Onde já está cada pessoa no período (tarefas abertas e eventos). Só um aviso: não bloqueia. */
export function useOcupacao({ desde, ate, horaInicio, horaFim, excluirTarefa, excluirEvento }: Opcoes) {
  const [ocupacao, setOcupacao] = useState<Record<string, Ocupacao[]>>({});

  useEffect(() => {
    if (!desde) {
      setOcupacao({});
      return;
    }
    let cancelado = false;
    const q = new URLSearchParams({ desde, ate: ate || desde });
    if (horaInicio && (!ate || ate === desde)) q.set("hora_inicio", horaInicio);
    if (horaFim && (!ate || ate === desde)) q.set("hora_fim", horaFim);
    if (excluirTarefa) q.set("excluir_tarefa", String(excluirTarefa));
    if (excluirEvento) q.set("excluir_evento", String(excluirEvento));
    const t = setTimeout(() => {
      api<{ pessoas: Record<string, Ocupacao[]> }>(`/ocupacao/?${q.toString()}`)
        .then((r) => !cancelado && setOcupacao(r.pessoas))
        .catch(() => !cancelado && setOcupacao({}));
    }, 400);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [desde, ate, horaInicio, horaFim, excluirTarefa, excluirEvento]);

  return ocupacao;
}

export function textoOcupacao(lst: Ocupacao[] | undefined): string {
  if (!lst?.length) return "";
  const nomes = { tarefa: "Tarefa", reuniao: "Reunião", visita: "Visita" } as const;
  return lst.map((o) => `${nomes[o.tipo]}: ${o.titulo} (${o.periodo})`).join("\n");
}
