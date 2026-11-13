// Cliente da API Django.
// Sessão sem renovação automática: o token fica em sessionStorage (apagado ao
// fechar o separador/navegador) e, quando expira, o utilizador volta ao login.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8484/api";

const TOKEN_KEY = "sp_token";
export const EVENTO_SESSAO_TERMINADA = "sp:sessao-terminada";

export type Perfil = "admin" | "tecnico" | "leitor";

export interface Utilizador {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  nome: string;
  funcao: string;
  tem_pessoa: boolean;
  perfil: Perfil;
}

export class ApiError extends Error {
  status: number;
  /** Erros por campo devolvidos pelo DRF, ex.: { nova: ["Esta palavra-passe é muito comum."] } */
  campos: Record<string, string[]>;
  constructor(status: number, message: string, campos: Record<string, string[]> = {}) {
    super(message);
    this.status = status;
    this.campos = campos;
  }
}

function lerToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function guardarToken(token: string) {
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* armazenamento bloqueado: o login falha de forma visível no pedido seguinte */
  }
}

/** Lê a data de expiração (campo exp) do JWT, sem verificar a assinatura. */
function expiraEm(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function terminarSessao() {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nada a fazer */
  }
}

/** Há sessão se existir um token ainda dentro da validade. */
export function temSessao(): boolean {
  const token = lerToken();
  if (!token) return false;
  const exp = expiraEm(token);
  if (exp !== null && exp <= Date.now()) {
    terminarSessao();
    return false;
  }
  return true;
}

async function erroDaResposta(r: Response): Promise<ApiError> {
  try {
    const dados = await r.json();
    if (typeof dados.detail === "string") return new ApiError(r.status, dados.detail);
    const campos: Record<string, string[]> = {};
    for (const [chave, valor] of Object.entries(dados)) {
      if (Array.isArray(valor)) campos[chave] = valor.map(String);
      else if (typeof valor === "string") campos[chave] = [valor];
    }
    const primeiro = Object.values(campos)[0]?.[0];
    return new ApiError(r.status, primeiro ?? `Erro ${r.status}`, campos);
  } catch {
    return new ApiError(r.status, `Erro ${r.status}`); // resposta sem JSON
  }
}

/** fetch autenticado. Um 401 termina a sessão e avisa a aplicação para voltar ao login. */
export async function api<T = unknown>(caminho: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = lerToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let r: Response;
  try {
    r = await fetch(`${API_URL}${caminho}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Não foi possível contactar o servidor. Verifique a ligação.");
  }

  if (r.status === 401) {
    terminarSessao();
    window.dispatchEvent(new Event(EVENTO_SESSAO_TERMINADA));
    throw new ApiError(401, "A sua sessão expirou. Inicie sessão novamente.");
  }
  if (!r.ok) throw await erroDaResposta(r);
  return (r.status === 204 ? undefined : await r.json()) as T;
}

/** Descarrega um ficheiro autenticado (ex.: Excel) e devolve-o com o nome sugerido pelo servidor. */
export async function descarregar(caminho: string, nomePorOmissao: string): Promise<{ blob: Blob; nome: string }> {
  const headers = new Headers();
  const token = lerToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let r: Response;
  try {
    r = await fetch(`${API_URL}${caminho}`, { headers });
  } catch {
    throw new ApiError(0, "Não foi possível contactar o servidor. Verifique a ligação.");
  }
  if (r.status === 401) {
    terminarSessao();
    window.dispatchEvent(new Event(EVENTO_SESSAO_TERMINADA));
    throw new ApiError(401, "A sua sessão expirou. Inicie sessão novamente.");
  }
  if (!r.ok) throw await erroDaResposta(r);

  const disp = r.headers.get("Content-Disposition") ?? "";
  const nome = /filename="?([^";]+)"?/.exec(disp)?.[1] ?? nomePorOmissao;
  return { blob: await r.blob(), nome };
}

/** Login: obtém o token e confirma que a conta tem um perfil atribuído. */
export async function iniciarSessao(username: string, password: string): Promise<Utilizador> {
  let r: Response;
  try {
    r = await fetch(`${API_URL}/auth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new ApiError(0, "Não foi possível contactar o servidor. Verifique a ligação.");
  }
  if (r.status === 401) throw new ApiError(401, "Utilizador ou palavra-passe incorrectos.");
  if (!r.ok) throw await erroDaResposta(r);

  const { access } = await r.json(); // o refresh token é ignorado de propósito
  guardarToken(access);

  try {
    return await api<Utilizador>("/auth/eu/");
  } catch (e) {
    terminarSessao();
    if (e instanceof ApiError && e.status === 403) {
      throw new ApiError(403, "A sua conta ainda não tem um perfil atribuído. Contacte o administrador.");
    }
    throw e;
  }
}