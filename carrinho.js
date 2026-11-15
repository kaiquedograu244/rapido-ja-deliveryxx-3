// Carrinho de compras do navegador (apenas itens em seleção; o pedido real é salvo no MySQL pela API C#).
(function () {
  const CHAVE = "rapidoja_carrinho";
  const MAX_QTD = 20;

  function ler() {
    try {
      const c = JSON.parse(localStorage.getItem(CHAVE));
      if (c && Array.isArray(c.itens)) return c;
    } catch {
      /* ignora */
    }
    return { restauranteId: null, restauranteNome: "", taxaEntrega: 0, itens: [] };
  }

  function gravar(c) {
    localStorage.setItem(CHAVE, JSON.stringify(c));
    window.dispatchEvent(new Event("carrinho-alterado"));
  }

  window.Carrinho = {
    obter: ler,

    adicionar(restaurante, produto) {
      let c = ler();
      if (c.restauranteId && c.restauranteId !== restaurante.id && c.itens.length > 0) {
        if (!confirm("Seu carrinho tem itens de " + c.restauranteNome + ". Deseja esvaziá-lo e começar um novo?")) {
          return false;
        }
        c = { restauranteId: null, restauranteNome: "", taxaEntrega: 0, itens: [] };
      }
      c.restauranteId = restaurante.id;
      c.restauranteNome = restaurante.nome;
      c.taxaEntrega = restaurante.taxaEntrega;
      const item = c.itens.find((i) => i.produtoId === produto.id);
      if (item) {
        if (item.quantidade >= MAX_QTD) return false;
        item.quantidade += 1;
      } else {
        c.itens.push({ produtoId: produto.id, nome: produto.nome, preco: produto.preco, quantidade: 1 });
      }
      gravar(c);
      return true;
    },

    alterar(produtoId, delta) {
      const c = ler();
      const item = c.itens.find((i) => i.produtoId === produtoId);
      if (!item) return;
      item.quantidade = Math.min(MAX_QTD, item.quantidade + delta);
      if (item.quantidade <= 0) c.itens = c.itens.filter((i) => i.produtoId !== produtoId);
      if (c.itens.length === 0) c.restauranteId = null;
      gravar(c);
    },

    limpar() {
      gravar({ restauranteId: null, restauranteNome: "", taxaEntrega: 0, itens: [] });
    },

    quantidadeTotal() {
      return ler().itens.reduce((s, i) => s + i.quantidade, 0);
    },

    subtotal() {
      return ler().itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
    }
  };
})();
