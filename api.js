(function () {
  const CHAVE_SESSAO = "rapidoja_sessao";
  const sb = window.supabase.createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_KEY);

  const Sessao = {
    obter() { try { return JSON.parse(localStorage.getItem(CHAVE_SESSAO)) || null; } catch { return null; } },
    salvar(d) { localStorage.setItem(CHAVE_SESSAO, JSON.stringify(d)); },
    atualizarUsuario(usuario) { const s = Sessao.obter(); if (s) Sessao.salvar({ ...s, usuario }); },
    limpar() { localStorage.removeItem(CHAVE_SESSAO); },
    token() { const s = Sessao.obter(); return s ? s.token : null; },
    usuario() { const s = Sessao.obter(); return s ? s.usuario : null; }
  };

  const img = (k) => (k && !k.includes("/") ? "img/" + k + ".png" : k);
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  const restaurante = (r) => ({
    id: r.id, nome: r.nome, categoria: r.categoria, descricao: r.descricao, imagemUrl: img(r.imagem_url),
    taxaEntrega: Number(r.taxa_entrega), tempoMin: r.tempo_min, tempoMax: r.tempo_max, avaliacao: Number(r.avaliacao)
  });
  const SELECT = "*, restaurantes(nome, imagem_url), itens_pedido(nome_produto, quantidade), historico_status(status, criado_em)";
  const entrega = (p, cliente) => ({
    id: p.id, pedidoId: p.id, status: p.status, restaurante: p.restaurantes && p.restaurantes.nome,
    imagemUrl: img(p.restaurantes && p.restaurantes.imagem_url), cliente: cliente || "",
    enderecoEntrega: p.endereco_entrega, formaPagamento: p.forma_pagamento, total: Number(p.total),
    criadoEm: p.criado_em, itens: (p.itens_pedido || []).map((i) => ({ quantidade: i.quantidade, nomeProduto: i.nome_produto })),
    historico: (p.historico_status || []).map((h) => ({ status: h.status, criadoEm: h.criado_em }))
      .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
  });

  async function usuarioAtual() {
    const { data } = await sb.auth.getUser();
    const u = data.user;
    if (!u) { Sessao.limpar(); throw new Error("Sessão expirada. Faça login novamente"); }
    const [p, roles] = await Promise.all([
      sb.from("profiles").select("*").eq("id", u.id).maybeSingle(),
      sb.from("user_roles").select("role").eq("user_id", u.id)
    ]);
    const pf = p.data || {};
    return { id: u.id, email: u.email, nome: pf.nome || u.email, telefone: pf.telefone || "", endereco: pf.endereco || "",
      admin: (roles.data || []).some((r) => r.role === "admin") };
  }
  async function sessaoCompleta(session) {
    return { token: session.access_token, usuario: await usuarioAtual() };
  }

  sb.auth.onAuthStateChange((evento, session) => {
    if (evento === "SIGNED_OUT") { Sessao.limpar(); window.dispatchEvent(new Event("sessao-alterada")); }
    else if (session && Sessao.obter()) { const s = Sessao.obter(); Sessao.salvar({ ...s, token: session.access_token }); }
  });

  window.Sessao = Sessao;
  window.Api = {
    async cadastro(d) {
      const r = ok(await sb.auth.signUp({ email: d.email, password: d.senha,
        options: { emailRedirectTo: location.origin + location.pathname, data: { nome: d.nome, telefone: d.telefone || "", endereco: d.endereco || "" } } }));
      if (!r.session) throw new Error("Conta criada! Confirme o link enviado para o seu e-mail e depois entre.");
      return sessaoCompleta(r.session);
    },
    async login(d) {
      const { data, error } = await sb.auth.signInWithPassword({ email: d.email, password: d.senha });
      if (error) throw new Error(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos" : error.message);
      return sessaoCompleta(data.session);
    },
    logout: () => sb.auth.signOut(),
    me: usuarioAtual,
    async atualizarPerfil(d) {
      const u = await usuarioAtual();
      ok(await sb.from("profiles").update({ nome: String(d.nome || "").slice(0, 120), telefone: String(d.telefone || "").slice(0, 30), endereco: String(d.endereco || "").slice(0, 255) }).eq("id", u.id));
      return usuarioAtual();
    },
    async rastrear(id) {
      const p = ok(await sb.from("pedidos").select(SELECT).eq("id", id).maybeSingle());
      if (!p) throw new Error("Pedido não encontrado");
      return entrega(p);
    },
    async listarEntregas(status) {
      let q = sb.from("pedidos").select(SELECT).order("id", { ascending: false }).limit(100);
      if (status) q = q.eq("status", status);
      const lista = ok(await q);
      const ids = [...new Set(lista.map((p) => p.usuario_id))];
      const perfis = ids.length ? ok(await sb.from("profiles").select("id, nome").in("id", ids)) : [];
      const nomes = new Map(perfis.map((p) => [p.id, p.nome]));
      return lista.map((p) => entrega(p, nomes.get(p.usuario_id)));
    },
    async atualizarStatus(id, status) { ok(await sb.rpc("atualizar_status", { _pedido_id: id, _status: status })); return Api.rastrear(id); },
    async categorias() {
      const d = ok(await sb.from("restaurantes").select("categoria"));
      return [...new Set(d.map((r) => r.categoria))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    },
    async restaurantes(categoria, busca) {
      let q = sb.from("restaurantes").select("*");
      if (categoria) q = q.eq("categoria", categoria);
      const t = String(busca || "").trim().replace(/[%,()*]/g, " ");
      if (t) {
        const prods = ok(await sb.from("produtos").select("restaurante_id").ilike("nome", "%" + t + "%"));
        const ids = [...new Set(prods.map((p) => p.restaurante_id))];
        const ors = ["nome.ilike.%" + t + "%", "descricao.ilike.%" + t + "%", "categoria.ilike.%" + t + "%"];
        if (ids.length) ors.push("id.in.(" + ids.join(",") + ")");
        q = q.or(ors.join(","));
      }
      return ok(await q.order("avaliacao", { ascending: false }).order("nome")).map(restaurante);
    },
    async restaurante(id) {
      const [r, p] = await Promise.all([
        sb.from("restaurantes").select("*").eq("id", id).maybeSingle(),
        sb.from("produtos").select("*").eq("restaurante_id", id).order("id")
      ]);
      const rest = ok(r);
      if (!rest) throw new Error("Restaurante não encontrado");
      return { restaurante: restaurante(rest), produtos: ok(p).map((x) => ({ id: x.id, nome: x.nome, descricao: x.descricao, preco: Number(x.preco) })) };
    },
    async criarPedido(d) {
      const id = ok(await sb.rpc("criar_pedido", { _restaurante_id: d.restauranteId, _endereco: d.enderecoEntrega,
        _pagamento: d.formaPagamento, _observacao: d.observacao || "", _itens: d.itens }));
      return { id };
    },
    async meusPedidos() {
      const u = (await sb.auth.getUser()).data.user;
      if (!u) throw new Error("Faça login para continuar");
      return ok(await sb.from("pedidos").select(SELECT).eq("usuario_id", u.id).order("id", { ascending: false })).map((p) => entrega(p));
    }
  };
})();
