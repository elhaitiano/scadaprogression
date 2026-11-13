// Tipos e utilitários de datas do planeamento (sem dependências externas).

export type EstadoTarefa = "concluida" | "bloqueada" | "atrasada" | "em_curso" | "planeada" | "sem_data";

export interface Tarefa {
  id: number;
  seccao: number;
  seccao_nome: string;
  sitio: number | null;
  localizacao: string;
  descricao: string;
  equipa: number[];
  equipa_nomes: string[];
  equipa_externa: string;
  equipa_texto: string;
  recursos: number | null;
  progresso: number;
  inicio: string | null; // AAAA-MM-DD
  fim: string | null;
  dias: number | null;
  estado: EstadoTarefa;
  bloqueado: boolean;
  motivo_bloqueio: string;
  notas: string;
  criado_em: string;
  criado_por_nome: string | null;
  actualizado_em: string;
  actualizado_por_nome: string | null;
}

export interface Pessoa {
  id: number;
  nome: string;
  funcao: string;
  activo: boolean;
}

export interface Seccao {
  id: number;
  nome: string;
  ordem: number;
}

export interface SitioResumo {
  id: number;
  tipo: string;
  nome: string;
  lote: string;
}

/** O DRF devolve uma lista simples, ou { count, results } se a paginação estiver activa. */
export type RespostaLista<T> = T[] | { results: T[] };

export function lista<T>(r: RespostaLista<T>): T[] {
  return Array.isArray(r) ? r : (r?.results ?? []);
}

export const ESTADOS: Record<EstadoTarefa, string> = {
  em_curso: "Em curso",
  planeada: "Planeada",
  atrasada: "Atrasada",
  bloqueada: "Bloqueada",
  sem_data: "Sem data",
  concluida: "Concluída",
};

export const DIAS_CURTOS = ["S", "T", "Q", "Q", "S", "S", "D"]; // segunda … domingo
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Data local → "AAAA-MM-DD" (sem passar por UTC). */
export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "AAAA-MM-DD" → Date local ao meio-dia (imune a mudanças de hora). */
export function deIso(s: string): Date {
  const [a, m, d] = s.split("-").map(Number);
  return new Date(a, m - 1, d, 12);
}

export function somarDias(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function segundaDe(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  return somarDias(r, -((r.getDay() + 6) % 7));
}

/** Início da janela do planeamento: segunda-feira da semana ANTERIOR (semana passada + semana actual). */
export function inicioJanela(d: Date): Date {
  return somarDias(segundaDe(d), -7);
}

/** "12–18 out" ou "26 out – 1 nov" quando a semana muda de mês. */
export function intervaloSemana(segunda: Date): string {
  const domingo = somarDias(segunda, 6);
  return segunda.getMonth() === domingo.getMonth()
    ? `${segunda.getDate()}–${domingo.getDate()} ${MESES[domingo.getMonth()]}`
    : `${segunda.getDate()} ${MESES[segunda.getMonth()]} – ${domingo.getDate()} ${MESES[domingo.getMonth()]}`;
}

/** Número da semana ISO 8601. */
export function semanaIso(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dia = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const inicioAno = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - inicioAno.getTime()) / 86400000 + 1) / 7);
}

export function dataCurta(s: string | null): string {
  if (!s) return "—";
  const [a, m, d] = s.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

export function diaMes(d: Date): string {
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

/** Os 14 dias da janela do planeamento (2 semanas a partir da segunda). */
export function diasDaJanela(segunda: Date): Date[] {
  return Array.from({ length: 14 }, (_, i) => somarDias(segunda, i));
}

/** A tarefa ocupa o dia d? (compara strings ISO, que ordenam como datas) */
export function ocupa(t: Tarefa, diaIso: string): boolean {
  return Boolean(t.inicio && t.fim && t.inicio <= diaIso && diaIso <= t.fim);
}

export function nomeSitio(s: SitioResumo): string {
  return `${s.tipo} ${s.nome}`;
}