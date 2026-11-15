// Agenda: reuniões, visitas/intervenções, prazos e as tarefas do planeamento.

import { deIso, iso, somarDias, segundaDe } from "./planeamento";

export type TipoEvento = "reuniao" | "visita" | "prazo";
export type TipoItem = TipoEvento | "tarefa";
export type EstadoEvento = "previsto" | "realizado" | "cancelado";
export type Vista = "mes" | "semana" | "lista";

export interface ItemAgenda {
  chave: string;
  origem: "evento" | "tarefa";
  id: number;
  tipo: TipoItem;
  titulo: string;
  data: string;
  data_fim: string;
  hora_inicio: string | null; // "HH:MM:SS"
  hora_fim: string | null;
  local: string;
  sitio: number | null;
  sitio_nome: string | null;
  pessoas: string[];
  externos: string;
  estado: string;              // evento: previsto/realizado/cancelado · tarefa: estado do planeamento
  progresso?: number;
  seccao?: string;
  equipa_texto?: string;
}

export interface RespostaAgenda {
  desde: string;
  ate: string;
  hoje: string;
  itens: ItemAgenda[];
}

export interface Evento {
  id: number;
  tipo: TipoEvento;
  titulo: string;
  data: string;
  data_fim: string | null;
  hora_inicio: string | null;
  hora_fim: string | null;
  local: string;
  sitio: number | null;
  tarefa: number | null;
  participantes: number[];
  participantes_externos: string;
  descricao: string;
  estado: EstadoEvento;
  criado_por_nome: string | null;
  actualizado_por_nome: string | null;
}

export const TIPOS: { id: TipoItem; nome: string; curto: string }[] = [
  { id: "reuniao", nome: "Reunião", curto: "Reunião" },
  { id: "visita", nome: "Visita / intervenção", curto: "Visita" },
  { id: "prazo", nome: "Prazo / marco", curto: "Prazo" },
  { id: "tarefa", nome: "Tarefa do planeamento", curto: "Tarefa" },
];

export const ESTADOS_EVENTO: { id: EstadoEvento; nome: string }[] = [
  { id: "previsto", nome: "Previsto" },
  { id: "realizado", nome: "Realizado" },
  { id: "cancelado", nome: "Cancelado" },
];

export const DIAS_SEMANA = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
export const DIAS_SEMANA_CURTOS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const fmtMes = new Intl.DateTimeFormat("pt-PT", { month: "long", year: "numeric" });
const fmtDiaLongo = new Intl.DateTimeFormat("pt-PT", { weekday: "long", day: "numeric", month: "long" });
const fmtDiaCurto = new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short" });

export function nomeMes(d: Date): string {
  const t = fmtMes.format(d);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function diaLongo(s: string): string {
  const t = fmtDiaLongo.format(deIso(s));
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function diaCurto(s: string): string {
  return fmtDiaCurto.format(deIso(s)).replace(".", "");
}

/** "10:00:00" → "10:00" */
export function hora(h: string | null): string {
  return h ? h.slice(0, 5) : "";
}

export function horario(i: { hora_inicio: string | null; hora_fim: string | null }): string {
  if (!i.hora_inicio) return "Dia inteiro";
  return i.hora_fim ? `${hora(i.hora_inicio)}–${hora(i.hora_fim)}` : hora(i.hora_inicio);
}

/** Dias (iso) mostrados para a vista e a data de referência. */
export function intervalo(vista: Vista, ref: Date): { desde: Date; ate: Date; dias: Date[] } {
  let desde: Date;
  let n: number;
  if (vista === "mes") {
    const primeiro = new Date(ref.getFullYear(), ref.getMonth(), 1, 12);
    const ultimo = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 12);
    desde = segundaDe(primeiro);
    const fim = somarDias(segundaDe(ultimo), 6);
    n = Math.round((fim.getTime() - desde.getTime()) / 86400000) + 1;
  } else if (vista === "semana") {
    desde = segundaDe(ref);
    n = 7;
  } else {
    desde = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 12);
    n = 14;
  }
  const dias = Array.from({ length: n }, (_, i) => somarDias(desde, i));
  return { desde, ate: dias[dias.length - 1], dias };
}

export function mover(vista: Vista, ref: Date, sentido: 1 | -1): Date {
  if (vista === "mes") return new Date(ref.getFullYear(), ref.getMonth() + sentido, 1, 12);
  return somarDias(ref, sentido * (vista === "semana" ? 7 : 14));
}

export function ocupaDia(i: ItemAgenda, dia: string): boolean {
  return i.data <= dia && dia <= i.data_fim;
}

export function variosDias(i: ItemAgenda): boolean {
  return i.data !== i.data_fim;
}

export { iso, deIso };
