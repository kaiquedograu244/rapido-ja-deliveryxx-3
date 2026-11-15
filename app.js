(function () {
  const app = document.getElementById("app");

  const STATUS = {
    RECEBIDO: "Pedido recebido",
    PREPARANDO: "Em preparo",
    A_CAMINHO: "Saiu para entrega",
    ENTREGUE: "Entregue",
    CANCELADO: "Cancelado"
  };
  const FLUXO = ["RECEBIDO", "PREPARANDO", "A_CAMINHO", "ENTREGUE"];
  const PAGAMENTOS = { PIX: "Pix", CARTAO: "Cartão na entrega", DINHEIRO: "Dinheiro" };

  let timerRastreio = null;

  // ---------------- utilitários ----------------
  const moeda = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const data = (v) => new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const esc = (t) =>
    String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function toast(msg, erro = false) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast" + (erro ? " toast-erro" : "");
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), 3500);
  }

  const carregando = () => (app.innerHTML = '<div class="carregando" aria-label="Carregando"><span></span></div>');
  const erroTela = (msg) =>
    (app.innerHTML = `<div class="vazio"><h2>Ops!</h2><p>${esc(msg)}</p><a class="btn btn-primario" href="#/">Voltar ao início</a></div>`);

  function exigirLogin() {
    if (!Sessao.token()) {
      location.hash = "#/login?voltar=" + encodeURIComponent(location.hash);
      return false;
    }
    return true;
  }

  function lerFormulario(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  async function enviando(botao, acao) {
    const texto = botao.textContent;
    botao.disabled = true;
    botao.textContent = "Aguarde...";
    try {
      await acao();
    } catch (e) {
      toast(e.message, true);
    } finally {
      botao.disabled = false;
      botao.textContent = texto;
    }
  }

  // ---------------- cabeçalho ----------------
  function atualizarMenu() {
    const usuario = Sessao.usuario();
    document.querySelectorAll("[data-requer-login]").forEach((el) => (el.hidden = !usuario));
    document.querySelectorAll("[data-sem-login]").forEach((el) => (el.hidden = !!usuario));
    document.querySelectorAll("[data-requer-admin]").forEach((el) => (el.hidden = !(usuario && usuario.admin)));
    if (usuario) document.getElementById("link-perfil").textContent = usuario.nome.split(" ")[0];
    document.getElementById("contador-carrinho").textContent = Carrinho.quantidadeTotal();
  }

  // ---------------- carrinho lateral ----------------
  const painel = document.getElementById("carrinho");
  const sombra = document.getElementById("sombra");

  function abrirCarrinho() {
    renderCarrinho();
    painel.classList.add("aberto");
    painel.setAttribute("aria-hidden", "false");
    sombra.hidden = false;
    document.getElementById("fechar-carrinho").focus();
  }
  function fecharCarrinho() {
    painel.classList.remove("aberto");
    painel.setAttribute("aria-hidden", "true");
    sombra.hidden = true;
  }

  function renderCarrinho() {
    const c = Carrinho.obter();
    const el = document.getElementById("carrinho-conteudo");
    if (c.itens.length === 0) {
      el.innerHTML = '<p class="texto-suave">Seu carrinho está vazio. Escolha um restaurante e adicione itens.</p>';
      return;
    }
    const subtotal = Carrinho.subtotal();
    el.innerHTML = `
      <p class="texto-suave">De <strong>${esc(c.restauranteNome)}</strong></p>
      <ul class="lista-carrinho">
        ${c.itens
          .map(
            (i) => `
          <li>
            <div><strong>${esc(i.nome)}</strong><span class="texto-suave">${moeda(i.preco)}</span></div>
            <div class="qtd">
              <button type="button" data-qtd="${i.produtoId}" data-delta="-1" aria-label="Remover um ${esc(i.nome)}">-</button>
              <span aria-label="Quantidade">${i.quantidade}</span>
              <button type="button" data-qtd="${i.produtoId}" data-delta="1" aria-label="Adicionar um ${esc(i.nome)}">+</button>
            </div>
          </li>`
          )
          .join("")}
      </ul>
      <dl class="resumo">
        <div><dt>Subtotal</dt><dd>${moeda(subtotal)}</dd></div>
        <div><dt>Taxa de entrega</dt><dd>${moeda(c.taxaEntrega)}</dd></div>
        <div class="total"><dt>Total</dt><dd>${moeda(subtotal + c.taxaEntrega)}</dd></div>
      </dl>
      <a href="#/checkout" class="btn btn-primario btn-bloco" id="ir-checkout">Finalizar pedido</a>
      <button type="button" class="btn btn-link" id="limpar-carrinho">Esvaziar carrinho</button>`;
  }

  painel.addEventListener("click", (e) => {
    const b = e.target.closest("[data-qtd]");
    if (b) {
      Carrinho.alterar(Number(b.dataset.qtd), Number(b.dataset.delta));
      renderCarrinho();
    }
    if (e.target.id === "limpar-carrinho") {
      Carrinho.limpar();
      renderCarrinho();
    }
    if (e.target.id === "ir-checkout") fecharCarrinho();
  });
  document.getElementById("btn-carrinho").addEventListener("click", abrirCarrinho);
  document.getElementById("fechar-carrinho").addEventListener("click", fecharCarrinho);
  sombra.addEventListener("click", fecharCarrinho);
  document.addEventListener("keydown", (e) => e.key === "Escape" && fecharCarrinho());

  // ---------------- páginas ----------------
  async function paginaInicio(params) {
    const categoria = params.get("categoria") || "";
    const busca = params.get("busca") || "";
    carregando();
    const [categorias, restaurantes] = await Promise.all([Api.categorias(), Api.restaurantes(categoria, busca)]);

    app.innerHTML = `
      <section class="hero">
        <h1>Bateu a fome? <span>A gente leva.</span></h1>
        <p>Os melhores restaurantes da cidade, entregues na sua porta.</p>
        <form class="busca" id="form-busca" role="search">
          <label for="campo-busca" class="sr-only">Buscar restaurante ou prato</label>
          <input id="campo-busca" name="busca" type="search" placeholder="Buscar restaurante ou prato" value="${esc(busca)}">
          <button class="btn btn-primario" type="submit">Buscar</button>
        </form>
      </section>
      <nav class="categorias" aria-label="Categorias">
        <a href="#/" class="${!categoria ? "ativo" : ""}">Todas</a>
        ${categorias
          .map((c) => `<a href="#/?categoria=${encodeURIComponent(c)}" class="${c === categoria ? "ativo" : ""}">${esc(c)}</a>`)
          .join("")}
      </nav>
      <h2 class="titulo-secao">${restaurantes.length} restaurante(s)</h2>
      ${
        restaurantes.length === 0
          ? '<p class="texto-suave">Nenhum restaurante encontrado.</p>'
          : `<div class="grade">${restaurantes
              .map(
                (r) => `
          <a class="card-restaurante" href="#/restaurante/${r.id}">
            <img src="${esc(r.imagemUrl)}" alt="" loading="lazy">
            <div class="card-corpo">
              <div class="linha"><h3>${esc(r.nome)}</h3><span class="nota" aria-label="Avaliação ${r.avaliacao}">★ ${Number(r.avaliacao).toFixed(1)}</span></div>
              <p class="texto-suave">${esc(r.categoria)} · ${r.tempoMin}-${r.tempoMax} min</p>
              <p class="texto-suave">Entrega ${moeda(r.taxaEntrega)}</p>
            </div>
          </a>`
              )
              .join("")}</div>`
      }`;

    document.getElementById("form-busca").addEventListener("submit", (e) => {
      e.preventDefault();
      const termo = e.target.busca.value.trim();
      location.hash = termo ? "#/?busca=" + encodeURIComponent(termo) : "#/";
    });
  }

  async function paginaRestaurante(id) {
    carregando();
    const { restaurante: r, produtos } = await Api.restaurante(id);
    app.innerHTML = `
      <a href="#/" class="voltar">&larr; Voltar</a>
      <section class="cabecalho-restaurante">
        <img src="${esc(r.imagemUrl)}" alt="Foto do ${esc(r.nome)}">
        <div>
          <h1>${esc(r.nome)}</h1>
          <p>${esc(r.descricao)}</p>
          <p class="texto-suave">★ ${Number(r.avaliacao).toFixed(1)} · ${esc(r.categoria)} · ${r.tempoMin}-${r.tempoMax} min · Entrega ${moeda(r.taxaEntrega)}</p>
        </div>
      </section>
      <h2 class="titulo-secao">Cardápio</h2>
      <ul class="cardapio">
        ${produtos
          .map(
            (p) => `
          <li class="produto">
            <div>
              <h3>${esc(p.nome)}</h3>
              <p class="texto-suave">${esc(p.descricao)}</p>
              <strong class="preco">${moeda(p.preco)}</strong>
            </div>
            <button type="button" class="btn btn-primario" data-add="${p.id}" aria-label="Adicionar ${esc(p.nome)} ao carrinho">Adicionar</button>
          </li>`
          )
          .join("")}
      </ul>`;

    app.querySelectorAll("[data-add]").forEach((b) =>
      b.addEventListener("click", () => {
        const produto = produtos.find((p) => p.id === Number(b.dataset.add));
        if (Carrinho.adicionar(r, produto)) toast(produto.nome + " adicionado ao carrinho");
      })
    );
  }

  function paginaLogin(params) {
    const voltar = params.get("voltar") || "#/";
    app.innerHTML = `
      <section class="caixa-auth">
        <div class="abas" role="tablist">
          <button type="button" role="tab" class="ativo" data-aba="login" aria-selected="true">Entrar</button>
          <button type="button" role="tab" data-aba="cadastro" aria-selected="false">Criar conta</button>
        </div>
        <form id="form-login" class="formulario">
          <label>E-mail<input name="email" type="email" required autocomplete="email"></label>
          <label>Senha<input name="senha" type="password" required autocomplete="current-password"></label>
          <button class="btn btn-primario btn-bloco" type="submit">Entrar</button>
          <p class="texto-suave dica">Admin de teste: <strong>admin@delivery.com</strong> / <strong>admin123</strong></p>
        </form>
        <form id="form-cadastro" class="formulario" hidden>
          <label>Nome completo<input name="nome" required maxlength="120" autocomplete="name"></label>
          <label>E-mail<input name="email" type="email" required maxlength="160" autocomplete="email"></label>
          <label>Senha (mín. 6 caracteres)<input name="senha" type="password" required minlength="6" maxlength="72" autocomplete="new-password"></label>
          <label>Telefone<input name="telefone" type="tel" maxlength="30" autocomplete="tel"></label>
          <label>Endereço<input name="endereco" maxlength="255" autocomplete="street-address"></label>
          <button class="btn btn-primario btn-bloco" type="submit">Criar conta</button>
        </form>
      </section>`;

    const formLogin = document.getElementById("form-login");
    const formCadastro = document.getElementById("form-cadastro");
    app.querySelectorAll("[data-aba]").forEach((aba) =>
      aba.addEventListener("click", () => {
        app.querySelectorAll("[data-aba]").forEach((a) => {
          a.classList.toggle("ativo", a === aba);
          a.setAttribute("aria-selected", a === aba);
        });
        formLogin.hidden = aba.dataset.aba !== "login";
        formCadastro.hidden = aba.dataset.aba !== "cadastro";
      })
    );

    const concluir = (resp) => {
      Sessao.salvar(resp);
      atualizarMenu();
      toast("Olá, " + resp.usuario.nome.split(" ")[0] + "!");
      location.hash = voltar;
    };

    formLogin.addEventListener("submit", (e) => {
      e.preventDefault();
      enviando(e.submitter, async () => concluir(await Api.login(lerFormulario(formLogin))));
    });
    formCadastro.addEventListener("submit", (e) => {
      e.preventDefault();
      enviando(e.submitter, async () => concluir(await Api.cadastro(lerFormulario(formCadastro))));
    });
  }

  function paginaCheckout() {
    if (!exigirLogin()) return;
    const c = Carrinho.obter();
    if (c.itens.length === 0) {
      app.innerHTML = '<div class="vazio"><h2>Carrinho vazio</h2><p>Adicione itens antes de finalizar.</p><a class="btn btn-primario" href="#/">Ver restaurantes</a></div>';
      return;
    }
    const usuario = Sessao.usuario();
    const subtotal = Carrinho.subtotal();
    app.innerHTML = `
      <h1>Finalizar pedido</h1>
      <div class="checkout">
        <form id="form-checkout" class="formulario cartao">
          <label>Endereço de entrega<input name="enderecoEntrega" required minlength="5" maxlength="255" value="${esc(usuario.endereco)}"></label>
          <fieldset>
            <legend>Forma de pagamento</legend>
            ${Object.entries(PAGAMENTOS)
              .map(
                ([v, t], i) => `<label class="opcao"><input type="radio" name="formaPagamento" value="${v}" ${i === 0 ? "checked" : ""}> ${t}</label>`
              )
              .join("")}
          </fieldset>
          <label>Observação (opcional)<textarea name="observacao" maxlength="255" rows="3" placeholder="Ex.: sem cebola, troco para R$ 100"></textarea></label>
          <button class="btn btn-primario btn-bloco" type="submit">Confirmar pedido · ${moeda(subtotal + c.taxaEntrega)}</button>
        </form>
        <aside class="cartao">
          <h2>${esc(c.restauranteNome)}</h2>
          <ul class="lista-simples">
            ${c.itens.map((i) => `<li><span>${i.quantidade}x ${esc(i.nome)}</span><span>${moeda(i.preco * i.quantidade)}</span></li>`).join("")}
          </ul>
          <dl class="resumo">
            <div><dt>Subtotal</dt><dd>${moeda(subtotal)}</dd></div>
            <div><dt>Entrega</dt><dd>${moeda(c.taxaEntrega)}</dd></div>
            <div class="total"><dt>Total</dt><dd>${moeda(subtotal + c.taxaEntrega)}</dd></div>
          </dl>
        </aside>
      </div>`;

    document.getElementById("form-checkout").addEventListener("submit", (e) => {
      e.preventDefault();
      const dados = lerFormulario(e.target);
      enviando(e.submitter, async () => {
        const pedido = await Api.criarPedido({
          restauranteId: c.restauranteId,
          enderecoEntrega: dados.enderecoEntrega,
          formaPagamento: dados.formaPagamento,
          observacao: dados.observacao,
          itens: c.itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade }))
        });
        Carrinho.limpar();
        toast("Pedido #" + pedido.id + " realizado!");
        location.hash = "#/rastreio/" + pedido.id;
      });
    });
  }

  async function paginaPedidos() {
    if (!exigirLogin()) return;
    carregando();
    const pedidos = await Api.meusPedidos();
    app.innerHTML = `
      <h1>Meus pedidos</h1>
      ${
        pedidos.length === 0
          ? '<div class="vazio"><p>Você ainda não fez pedidos.</p><a class="btn btn-primario" href="#/">Pedir agora</a></div>'
          : `<ul class="lista-pedidos">${pedidos
              .map(
                (p) => `
          <li class="cartao pedido">
            <img src="${esc(p.imagemUrl)}" alt="">
            <div class="pedido-info">
              <div class="linha"><h3>${esc(p.restaurante)}</h3><span class="status status-${p.status}">${STATUS[p.status] || p.status}</span></div>
              <p class="texto-suave">Pedido #${p.id} · ${data(p.criadoEm)}</p>
              <p class="texto-suave">${p.itens.map((i) => i.quantidade + "x " + esc(i.nomeProduto)).join(", ")}</p>
              <div class="linha"><strong>${moeda(p.total)}</strong><a class="btn btn-contorno btn-pequeno" href="#/rastreio/${p.id}">Acompanhar</a></div>
            </div>
          </li>`
              )
              .join("")}</ul>`
      }`;
  }

  async function paginaRastreio(id) {
    if (!exigirLogin()) return;
    carregando();

    async function desenhar() {
      const e = await Api.rastrear(id);
      if (!location.hash.startsWith("#/rastreio/" + id)) return;
      const indice = FLUXO.indexOf(e.status);
      const horario = (s) => {
        const h = e.historico.find((x) => x.status === s);
        return h ? data(h.criadoEm) : "";
      };
      app.innerHTML = `
        <a href="#/pedidos" class="voltar">&larr; Meus pedidos</a>
        <h1>Pedido #${e.pedidoId}</h1>
        <p class="texto-suave">${esc(e.restaurante)} · ${moeda(e.total)} · ${PAGAMENTOS[e.formaPagamento] || esc(e.formaPagamento)}</p>
        <div class="cartao">
          ${
            e.status === "CANCELADO"
              ? '<p class="status status-CANCELADO">Este pedido foi cancelado.</p>'
              : `<ol class="linha-tempo">
            ${FLUXO.map(
              (s, i) => `
              <li class="${i < indice ? "feito" : i === indice ? "atual" : ""}">
                <span class="ponto" aria-hidden="true"></span>
                <div><strong>${STATUS[s]}</strong><span class="texto-suave">${horario(s)}</span></div>
              </li>`
            ).join("")}
          </ol>`
          }
          <p class="texto-suave">Entrega em: <strong>${esc(e.enderecoEntrega)}</strong></p>
          ${e.status !== "ENTREGUE" && e.status !== "CANCELADO" ? '<p class="texto-suave dica">Atualizando automaticamente a cada 5 segundos.</p>' : ""}
        </div>`;
      if (e.status === "ENTREGUE" || e.status === "CANCELADO") clearInterval(timerRastreio);
    }

    await desenhar();
    timerRastreio = setInterval(() => desenhar().catch(() => clearInterval(timerRastreio)), 5000);
  }

  function paginaPerfil() {
    if (!exigirLogin()) return;
    const u = Sessao.usuario();
    app.innerHTML = `
      <section class="caixa-auth">
        <h1>Meu perfil</h1>
        <p class="texto-suave">${esc(u.email)}</p>
        <form id="form-perfil" class="formulario">
          <label>Nome<input name="nome" required maxlength="120" value="${esc(u.nome)}"></label>
          <label>Telefone<input name="telefone" type="tel" maxlength="30" value="${esc(u.telefone)}"></label>
          <label>Endereço padrão<input name="endereco" maxlength="255" value="${esc(u.endereco)}"></label>
          <button class="btn btn-primario btn-bloco" type="submit">Salvar</button>
        </form>
        <button type="button" class="btn btn-contorno btn-bloco" id="sair">Sair da conta</button>
      </section>`;

    document.getElementById("form-perfil").addEventListener("submit", (e) => {
      e.preventDefault();
      enviando(e.submitter, async () => {
        const usuario = await Api.atualizarPerfil(lerFormulario(e.target));
        Sessao.atualizarUsuario(usuario);
        atualizarMenu();
        toast("Perfil atualizado");
      });
    });
    document.getElementById("sair").addEventListener("click", async () => {
      try {
        await Api.logout();
      } catch {
        /* a sessão local é limpa de qualquer forma */
      }
      Sessao.limpar();
      atualizarMenu();
      location.hash = "#/";
    });
  }

  async function paginaAdmin(params) {
    if (!exigirLogin()) return;
    const usuario = Sessao.usuario();
    if (!usuario.admin) return erroTela("Acesso restrito ao administrador.");
    const filtro = params.get("status") || "";
    carregando();
    const entregas = await Api.listarEntregas(filtro);

    const proximo = (s) => FLUXO[FLUXO.indexOf(s) + 1];
    app.innerHTML = `
      <h1>Painel do restaurante</h1>
      <nav class="categorias" aria-label="Filtrar por status">
        <a href="#/admin" class="${!filtro ? "ativo" : ""}">Todos</a>
        ${Object.keys(STATUS).map((s) => `<a href="#/admin?status=${s}" class="${s === filtro ? "ativo" : ""}">${STATUS[s]}</a>`).join("")}
      </nav>
      ${
        entregas.length === 0
          ? '<p class="texto-suave">Nenhum pedido encontrado.</p>'
          : `<div class="tabela-wrap"><table class="tabela">
          <thead><tr><th>#</th><th>Cliente</th><th>Restaurante</th><th>Total</th><th>Data</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>
            ${entregas
              .map((e) => {
                const final = e.status === "ENTREGUE" || e.status === "CANCELADO";
                const prox = proximo(e.status);
                return `<tr>
                <td>${e.pedidoId}</td>
                <td>${esc(e.cliente)}<br><span class="texto-suave">${esc(e.enderecoEntrega)}</span></td>
                <td>${esc(e.restaurante)}</td>
                <td>${moeda(e.total)}</td>
                <td>${data(e.criadoEm)}</td>
                <td><span class="status status-${e.status}">${STATUS[e.status]}</span></td>
                <td class="acoes">
                  ${!final && prox ? `<button type="button" class="btn btn-primario btn-pequeno" data-status="${prox}" data-id="${e.pedidoId}">${STATUS[prox]}</button>` : ""}
                  ${!final ? `<button type="button" class="btn btn-contorno btn-pequeno" data-status="CANCELADO" data-id="${e.pedidoId}">Cancelar</button>` : ""}
                </td>
              </tr>`;
              })
              .join("")}
          </tbody></table></div>`
      }`;

    app.querySelectorAll("[data-status]").forEach((b) =>
      b.addEventListener("click", () =>
        enviando(b, async () => {
          await Api.atualizarStatus(Number(b.dataset.id), b.dataset.status);
          toast("Pedido #" + b.dataset.id + ": " + STATUS[b.dataset.status]);
          await paginaAdmin(params);
        })
      )
    );
  }

  // ---------------- roteador ----------------
  async function rotear() {
    clearInterval(timerRastreio);
    const [caminho, query] = (location.hash.slice(1) || "/").split("?");
    const params = new URLSearchParams(query || "");
    const partes = caminho.split("/").filter(Boolean);

    try {
      if (partes.length === 0) await paginaInicio(params);
      else if (partes[0] === "restaurante" && partes[1]) await paginaRestaurante(Number(partes[1]));
      else if (partes[0] === "login") paginaLogin(params);
      else if (partes[0] === "checkout") paginaCheckout();
      else if (partes[0] === "pedidos") await paginaPedidos();
      else if (partes[0] === "rastreio" && partes[1]) await paginaRastreio(Number(partes[1]));
      else if (partes[0] === "perfil") paginaPerfil();
      else if (partes[0] === "admin") await paginaAdmin(params);
      else erroTela("Página não encontrada.");
    } catch (e) {
      erroTela(e.message);
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", rotear);
  window.addEventListener("carrinho-alterado", atualizarMenu);
  window.addEventListener("sessao-alterada", atualizarMenu);

  atualizarMenu();
  rotear();

  // Revalida a sessão salva com a API Java
  if (Sessao.token()) {
    Api.me()
      .then((u) => {
        Sessao.atualizarUsuario(u);
        atualizarMenu();
      })
      .catch(() => atualizarMenu());
  }
})();
