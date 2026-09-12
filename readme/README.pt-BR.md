# Trans-Hub Localizer

**Os plugins da comunidade do Obsidian no seu idioma.**

[English](../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · **Português (Brasil)** · [Русский](README.ru.md)

[![Release](https://img.shields.io/github/v/release/SakenW/trans-hub-obsidian-localizer)](https://github.com/SakenW/trans-hub-obsidian-localizer/releases) · **Desktop e dispositivos móveis** · **Sem configurar modelos de IA ou chaves de API**

O Trans-Hub Localizer é um plugin do Obsidian que traduz e localiza as interfaces dos plugins da comunidade. Ele preserva as traduções integradas detectadas, preenche o conteúdo ausente com traduções compartilhadas e sincroniza automaticamente as atualizações publicadas. Por padrão, aplica as traduções durante a execução, sem modificar os arquivos dos plugins. Ele não traduz nem envia suas notas.

[Instalar no Obsidian](obsidian://show-plugin?id=trans-hub-plugin-localizer) · [Progresso da localização](https://trans-hub.net/ecosystems/obsidian) · [Feedback e comunidade](https://github.com/SakenW/Trans-Hub/discussions)

<!-- section: getting-started -->
## Primeiros passos

Você precisa do **Obsidian 1.11.4 ou superior**, de uma conta do Trans-Hub e de conexão de rede para autorização e sincronização. Há suporte a desktop e dispositivos móveis; os patches avançados de compatibilidade de arquivos estão disponíveis apenas no desktop.

1. Instale e ative o **Trans-Hub Localizer** em **Configurações → Plugins da comunidade**.
2. Abra as configurações do plugin e conecte sua conta do Trans-Hub. Não é necessário configurar um modelo de IA, uma conta de provedor de modelos ou uma chave de API.
3. Confirme o idioma de destino. Os plugins da comunidade ativados são detectados automaticamente; você pode excluir aqueles que não deseja localizar.

As traduções já publicadas são reutilizadas. O conteúdo ausente gera automaticamente uma solicitação de localização e é sincronizado após o processamento em segundo plano e a publicação. O texto pode continuar no idioma original enquanto aguarda processamento, publicação ou verificações de compatibilidade.

Para instalar manualmente, baixe `main.js`, `manifest.json` e `styles.css` da mesma [versão no GitHub](https://github.com/SakenW/trans-hub-obsidian-localizer/releases) e coloque-os em `<vault-config-dir>/plugins/trans-hub-plugin-localizer/`. Não misture arquivos de versões diferentes.

<!-- section: capabilities -->
## Recursos

| Recurso | Comportamento |
| --- | --- |
| Prioridade às traduções integradas | Preserva as traduções detectadas no plugin instalado e preenche os textos ausentes. Somente correções explicitamente revisadas podem substituir o texto integrado correspondente. |
| Traduções compartilhadas | Usuários reutilizam os resultados publicados; o conteúdo ausente segue o fluxo compartilhado de localização. |
| Sincronização automática | Ao iniciar, restaura primeiro as traduções validadas em cache e continua buscando atualizações durante a execução. Novas traduções exigem conexão de rede. |
| Reutilização compatível após atualizações | Traduções em tempo de execução podem ser reutilizadas entre versões quando cada entrada passa nas verificações de compatibilidade. Entradas ambíguas ou incompatíveis são ignoradas. |
| Cobertura de interface | Abrange nomes, descrições, configurações, botões, comandos, avisos, opções, dicas, orientações de entrada, rótulos de acessibilidade e alguns textos dinâmicos que possam ser identificados com segurança. |
| README do plugin | Pode localizar os textos aceitos na página de detalhes de um plugin da comunidade quando há traduções README publicadas e correspondentes. Essa cobertura é contabilizada separadamente da interface principal. |

Conforme o caso, são verificadas a identidade da origem, o escopo, o papel semântico, o formato e os marcadores dinâmicos. Não há promessa de tradução completa de todas as interfaces de todos os plugins.

<!-- section: languages -->
## Suporte a todos os idiomas

Os idiomas de destino não estão restritos a uma lista fixa. Escolha um idioma comum ou informe uma tag no campo de outros idiomas, preservando variantes regionais e de escrita.

As opções rápidas incluem **chinês simplificado, chinês tradicional, inglês, japonês, coreano, alemão, francês, espanhol, português do Brasil e russo**. Outros exemplos são italiano (`it`), árabe (`ar`), ucraniano (`uk`) e sérvio em alfabeto latino (`sr-Latn`). A disponibilidade e a qualidade das traduções dependem dos resultados publicados e dos serviços de processamento disponíveis para o idioma solicitado.

Esses são os **idiomas de tradução de outros plugins**. As configurações do próprio Localizer atualmente oferecem chinês simplificado e inglês; os demais idiomas usam inglês. Os links no topo alteram apenas o idioma deste README.

<!-- section: quality -->
## Qualidade e escopo

Atualmente, a maioria das traduções do Trans-Hub é gerada automaticamente e não passou por revisão humana. O plugin diferencia a origem da tradução e o status de revisão. A validação da origem e da compatibilidade não significa que uma pessoa tenha revisado a precisão linguística.

O fluxo atende a plugins da comunidade cuja identidade e versão possam ser verificadas pelo diretório oficial do Obsidian e por fontes originais confiáveis. A instalação via BRAT, plugins privados ou alterações locais arbitrárias não recebem automaticamente uma garantia de compatibilidade. O fluxo atual usa inglês como idioma de origem.

Editores Markdown e visualizações de leitura de notas, código, scripts e conteúdo editável ficam excluídos. A localização de README se limita à página de detalhes do plugin da comunidade e não ativa a tradução de notas.

<!-- section: privacy -->
## Privacidade e patches de arquivos opcionais

- A análise local identifica as versões dos plugins e os textos de interface aceitos. Os textos analisados e as notas não são enviados.
- As solicitações incluem identidade do plugin, versão, idioma de destino, contagens de cobertura e resumos criptográficos. A autorização da conta e o download de traduções exigem acesso à rede.
- As credenciais usam o armazenamento seguro do Obsidian. Consulte a [política de privacidade](https://trans-hub.net/zh-CN/legal/privacy) para saber sobre o processamento no servidor.
- Por padrão, a localização em tempo de execução não reescreve arquivos dos plugins. Ao desativá-la, são restaurados os textos que ainda mantêm o valor traduzido, preservando alterações posteriores feitas por outros plugins.

**O modo de compatibilidade avançado está disponível apenas no desktop e vem desativado por padrão.** Você deve aplicar explicitamente o patch a cada plugin elegível. Ele modifica somente textos estáticos de interface validados, vinculados à versão e ao artefato exatos, após salvar um backup e um comprovante. A restauração só ocorre se o arquivo ainda corresponder ao resumo criptográfico posterior ao patch. Atualizações do plugin e alterações externas são preservadas e informadas como conflitos. Recarregue o plugin afetado após aplicar ou restaurar um patch. Os patches nunca modificam notas.

<!-- section: faq -->
## Perguntas frequentes

**Preciso de uma chave de API?** Não. Conecte uma conta do Trans-Hub; não é necessário configurar modelos ou chaves de API.

**Funciona no celular?** Sim, a localização em tempo de execução oferece suporte a dispositivos móveis e desktop. Os patches de compatibilidade de arquivos só estão disponíveis no desktop.

**Por que alguns textos continuam sem tradução?** A tradução pode estar pendente, a origem pode não ser verificável ou a interface pode não ser identificável com segurança. Confira o status do plugin. A ausência de traduções publicadas não significa que o idioma não seja aceito.

**E se o plugin já tiver meu idioma?** As traduções integradas detectadas têm prioridade. As traduções compartilhadas preenchem as lacunas; correções revisadas são uma exceção separada e explícita.

**O que acontece após atualizar um plugin?** A compatibilidade é verificada novamente. Entradas reutilizáveis continuam ativas; as incompatíveis aguardam traduções atualizadas. Patches de arquivos continuam exigindo uma correspondência exata.

**Posso usar sem conexão?** Você pode reutilizar traduções já validadas e armazenadas em cache. Autorização, processamento de conteúdo ausente e novos downloads exigem conexão de rede.

<!-- section: contribute -->
## Contribua e obtenha ajuda

Participe da [tradução, revisão e manutenção de terminologia](https://trans-hub.net/ecosystems/obsidian). Relate problemas reproduzíveis em [Issues](https://github.com/SakenW/trans-hub-obsidian-localizer/issues) e envie dúvidas ou sugestões em [Discussions](https://github.com/SakenW/Trans-Hub/discussions).

O [README em chinês simplificado](README.zh-CN.md) é a fonte de conteúdo de todas as versões; o inglês é a entrada padrão no GitHub. Veja as [orientações de contribuição](../CONTRIBUTING.md) para sincronizar as traduções.

<!-- section: build -->
## Compilação e licença

Use Node.js 24 e pnpm 10.34.4:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm type-check
pnpm test
pnpm verify:public-copy
pnpm build
```

As tags de versão devem corresponder a `manifest.json`, `package.json` e `versions.json`. Versões anteriores à `1.0.0` são versões de teste públicas. Licença [Apache-2.0](../LICENSE).
