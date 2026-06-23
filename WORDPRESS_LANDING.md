# Integracao com landing WordPress

Este projeto gera links de divulgacao para afiliados, registra cliques no
backend e envia o visitante para a landing publica no WordPress.

## Fluxo

1. O painel cria um link com destino para a landing WordPress.
2. O afiliado divulga o link gerado pelo backend:
   `http://72.62.8.85:3001/r/abc123`
3. Ao abrir esse link, o backend registra o clique e redireciona para:
   `https://SUA-LANDING.com/express?ref=abc123`
4. O botao de WhatsApp da landing le `ref=abc123` e aponta para:
   `http://72.62.8.85:3001/links/abc123/whatsapp?product=Plano%20Familia%20Netbox`
5. O backend registra a conversao e redireciona para o WhatsApp.

## Variaveis apos migrar hospedagem

No backend, atualize a URL publica do backend e a URL da landing:

```env
APP_URL="http://72.62.8.85:3001"
LANDING_PAGE_URL="https://SUA-LANDING-WORDPRESS.com/express"
WHATSAPP_NUMBER=55008006022732
WHATSAPP_MESSAGE="Tenho interesse no Plano Familia Netbox."
```

Se o backend estiver em uma maquina via SSH/VPS atras de Nginx, o dominio
publico precisa apontar para essa maquina e o Nginx deve encaminhar para a porta
do Node, por exemplo:

```nginx
location / {
  proxy_pass http://127.0.0.1:3001;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

No frontend administrativo:

```env
NEXT_PUBLIC_API_URL=http://72.62.8.85:3001
NEXT_PUBLIC_LANDING_PAGE_URL=https://SUA-LANDING-WORDPRESS.com/express
```

Depois de alterar variaveis em hospedagem, faca redeploy/restart do servico.

## Snippet recomendado para WordPress

No botao do WhatsApp no WordPress/Elementor, coloque a classe CSS:

```txt
whatsapp-conversion
```

Depois cole este script em um bloco "HTML personalizado" da landing ou em um
campo de scripts do tema.

```html
<script
  src="http://72.62.8.85:3001/wordpress/landing.js"
  data-product="Plano Familia Netbox"
  defer
></script>
```

O script tambem reconhece `ref`, `shortCode` ou `link` na URL da landing e salva
o codigo em `localStorage`, assim a conversao continua atribuida mesmo se o
visitante navegar na pagina antes de clicar.

Se preferir usar outra classe no botao, informe o seletor no script:

```html
<script
  src="http://72.62.8.85:3001/wordpress/landing.js"
  data-button-selector=".minha-classe-do-whatsapp"
  data-product="Plano Familia Netbox"
  defer
></script>
```

## Checklist rapido

1. `http://72.62.8.85:3001/health` deve responder `status: online`.
2. `http://72.62.8.85:3001/wordpress/landing.js` deve abrir um arquivo JavaScript.
3. Um link `/r/CODIGO` deve redirecionar para a landing com `?ref=CODIGO`.
4. Na landing com `?ref=CODIGO`, o botao deve apontar para `/links/CODIGO/whatsapp`.
5. Divulgue sempre o link do backend (`/r/CODIGO`), nunca a URL direta do WordPress.

Observacao: links antigos salvos com o dominio anterior passam a aparecer no
painel com o dominio da requisicao atual. `APP_URL` fica como fallback quando a
API nao conseguir inferir o dominio pela requisicao.
