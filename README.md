# Apex Thermal Control

**Análise térmica do radiador automotivo com monitoramento e previsão de temperatura**

Plataforma web para monitorar o sistema de arrefecimento de um veículo a partir de dados
reais de OBD-II, calcular o desempenho do radiador pelo método efetividade–NTU e prever a
temperatura do líquido de arrefecimento alguns minutos à frente.

Trabalho da disciplina de **Transferência de Calor** — UniCuritiba.
Bancada de ensaio: **Chevrolet Cruze LT 1.8 (2016)**, instrumentado.

---

## Como abrir

Não precisa de servidor, instalação nem internet:

```
abra o arquivo index.html no navegador
```

Todo o processamento acontece no navegador. Nenhum dado da coleta sai da máquina.

Para publicar como site: em **Settings → Pages** do repositório, selecione a branch
`main` e a pasta `/ (root)`. O site fica disponível em
`https://<usuario>.github.io/Apex-Thermal-Control/`.

## O que a plataforma faz

| Aba | Função |
| --- | --- |
| **Painel** | Mostradores e séries temporais da coleta, com reprodução instante a instante |
| **Entenda o cálculo** | A mesma conta da análise, em português e desenhada: esquema do circuito com os valores reais, memória de cálculo passo a passo, as comparações que dizem se o resultado é bom e uma superfície 3D onde dá para mexer nos parâmetros e ver o relevo mudar |
| **Importar dados** | Lê o CSV do scanner OBD-II e o do logger de temperatura, detecta as colunas e sincroniza as duas fontes |
| **Análise térmica** | Balanço de energia, efetividade–NTU, UA, resultados por regime e calibração do modelo |
| **Previsão** | Treina e valida o modelo de previsão de temperatura; detecta anomalias |
| **Alertas** | Alertas preditivos e medição da antecedência conseguida |
| **Relatório** | Relatório técnico da coleta, exportável em PDF, CSV e JSON |
| **Projeto** | Escopo, ementa, método, riscos e os itens pendentes da disciplina, que se marcam e ficam salvos no navegador |

Qualquer ação da plataforma também é alcançável pelo teclado: **Ctrl+K** (ou **⌘K**) abre
uma busca sobre tudo que ela sabe fazer — trocar de aba, carregar uma coleta, calibrar,
treinar o modelo, exportar.

## Dois modos

A plataforma tem duas peles, e as duas rodam exatamente o mesmo cálculo.

**Work mode** é o padrão e é onde o trabalho acontece: papel claro, hierarquia
tipográfica, quase nenhum efeito. É o que vai impresso no relatório.

**Speed mode** é um easter egg oficial — homenagem ao painel automotivo, ativado pelo
botão **SPEED MODE** no cabeçalho. Ele troca a interface inteira por um HUD de carbono e
abre três telas exclusivas:

| Tela | O que mostra |
| --- | --- |
| **Cluster** | Conta-giros, temperatura e velocidade em ponteiros, mais quatro manômetros — pressão de óleo, de combustível, de turbo e AFR — com a telemetria da coleta rodando |
| **ECU** | Oito telas de central eletrônica: Engine, Turbo, Injectors, **Tune**, Logger, Maps, Diagnostics, Telemetry |
| **Dyno** | Passada de dinamômetro com os mapas da aba Tune, e o veredito de quanto tempo o radiador real seguraria aquilo |

### A bancada de remapeamento

A aba **Tune** é uma tabela rotação × carga que se edita célula a célula — combustível,
ignição, pressão de turbo e AFR alvo — com a superfície do mapa ao lado e o resultado
aparecendo na hora. Clique numa célula, ande com as setas, ajuste com + e −. Há quatro
presets prontos (Original, Rua, Pista, Míssil) e tudo fica salvo no navegador.

O que faz valer a brincadeira é o motor de mentira ter os compromissos certos:

- pressão sem combustível na mesma proporção **empobrece a mistura** e derrete pistão;
- avanço acima do limite que a pressão aguenta **detona**, e a potência despenca;
- AFR longe de 12,5:1 custa potência.

Os presets são mapas que fecham — 122 cv de fábrica, 204 no Míssil, todos limpos. Quebrar
é por conta de quem edita, e a tela avisa qual dos dois jeitos você escolheu.

E o dinamômetro fecha o ciclo com a parte séria: calcula o calor que aquele motor jogaria
no líquido e compara com o que o núcleo entrega a 100 km/h, pelas correlações com o fator
de calibração da coleta carregada. Depois usa a capacitância concentrada do próprio modelo
térmico para responder a única pergunta que importa: **por quanto tempo**. Com o mapa de
fábrica, 31 segundos de pé embaixo até o alarme. Com o Míssil, 6.

Fora a bancada de remapeamento, que é ficção assumida e está marcada como tal em cada tela, nenhum indicador do speed mode é inventado. O conta-giros mostra a rotação que veio do
PID `010C`, o "boost" é o calor rejeitado pelo radiador, a "pressão de óleo" é o índice de
saúde do núcleo, o "AFR" é a razão de capacidades C_r e o nitro enche conforme a margem
que ainda existe até o limite crítico. Cada tela diz, embaixo do número, qual grandeza
térmica ela está mostrando. O que é fictício é a apresentação, não o dado.

O modo escolhido fica lembrado no navegador. A sequência de partida — a tela de boot da
ECU — só toca quando o modo é ativado, não a cada visita.

## Aquisição de dados

**1. Scanner OBD-II (Android)**

Adaptador ELM327 Bluetooth na tomada OBD-II — no Cruze, embaixo do painel à esquerda do
volante, acima do descanso do pé esquerdo. Gravar com o Car Scanner ELM OBD2 ou o Torque
Pro, deixando ativos **apenas** os PIDs necessários (o ELM327 lê um por vez, e cada PID
extra reduz a taxa de amostragem de todos):

| PID | Grandeza |
| --- | --- |
| `0105` | Temperatura do líquido de arrefecimento |
| `010C` | Rotação do motor |
| `010D` | Velocidade do veículo |
| `0104` | Carga calculada do motor |
| `010F` | Temperatura do ar de admissão |

Confirme que o app está gravando **timestamp em cada linha** — sem isso não é possível
sincronizar com o logger de temperatura.

**2. Logger de temperatura (ESP32 + 2× DS18B20)**

Um sensor na mangueira superior e outro na inferior do radiador. O ΔT entre eles é o que
fecha o balanço de energia: sem ele a plataforma roda em *modo modelo*, com a efetividade
estimada em vez de medida.

Como os dois arquivos vêm de relógios diferentes (o ESP32 conta desde a energização),
acerte o relógio antes de cada coleta ou marque um evento comum no início — dar a partida,
por exemplo. A aba de importação tem alinhamento automático e ajuste manual de offset.

## Modos de cálculo

- **Modo experimental** — há ΔT medido. O calor rejeitado vem do balanço de energia
  `Q̇ = ṁ·c_p·ΔT` e a efetividade é um resultado experimental.
- **Modo modelo** — só há OBD-II. O calor e a efetividade são estimados pelas correlações
  de convecção e ficam explicitamente rotulados como estimativa.

## Método

```
Q̇      = ṁ_liq · c_p,liq · (T_ent − T_sai)
Q̇_máx  = C_mín · (T_h,ent − T_c,ent)
ε      = Q̇ / Q̇_máx
ε      = 1 − exp{ (NTU^0,22 / C_r) · [ exp(−C_r·NTU^0,78) − 1 ] }     (fluxo cruzado, fluidos não-misturados)
NTU    = UA / C_mín                                                    (invertido numericamente a partir de ε)
1/UA   = 1/(η_s·h_ar·A_ar) + t/(k_al·A) + 1/(h_liq·A_liq)
Nu     = C·Re^m·Pr^(1/3)                                               (lado ar)
Nu     = 0,023·Re^0,8·Pr^0,3                                           (lado líquido, turbulento)
```

A plataforma também propaga a incerteza dos instrumentos pela cadeia inteira, calcula a
média logarítmica das diferenças de temperatura com o fator de correção implícito, e
reporta o fator *j* de Colburn, o número de Stanton, a perda de carga dos dois lados e a
potência gasta para mover os fluidos.

### Um resultado que vale registrar

Quando o líquido é o fluido de menor capacidade térmica, a vazão aparece no calor
rejeitado **e** no calor máximo, e cancela: a efetividade se reduz a ΔT / (T_líquido −
T_ar), função apenas de temperaturas. O parâmetro mais incerto da montagem — a vazão da
bomba — não contamina o resultado principal nesse regime.

Quando o ar limita, a vazão não cancela, e as duas incertezas de vazão entram inteiras. Na
coleta de demonstração isso põe a efetividade em 0,432 ± 0,140 (32 %), e a barra de erro
passa a ser dominada pelo lado do ar: reduzi-la exige um anemômetro, não um sensor melhor
de temperatura. Baixar a incerteza da velocidade de face de 25 % para 5 % nos parâmetros
leva a incerteza de ε de 32 % para 21 % — dá para ver o que o instrumento compraria antes
de comprá-lo.

O UA sai ainda pior, porque a inversão NTU(ε) é muito não-linear: cada 1 % de incerteza em
ε vira ~1,4 % em NTU no ponto de operação da demonstração, e piora rápido conforme ε sobe.

O modelo de previsão é uma regressão linear regularizada sobre janela deslizante. O alvo é
a **variação** de temperatura no horizonte, não o valor absoluto. A validação usa blocos
contíguos — a série temporal não é embaralhada, porque amostras vizinhas são quase
idênticas e o modelo veria o próprio alvo. Uma das variáveis de entrada é a previsão do
modelo físico de capacitância concentrada: é a abordagem híbrida do projeto, em que a
física explica a parcela conhecida e o modelo estatístico aprende o resíduo.

## Calibração e índice de saúde

O UA teórico calculado pelas correlações carrega o viés da geometria estimada. Por isso:

1. Colete com o radiador em bom estado.
2. Rode **Calibrar pelos dados desta coleta** na aba Análise térmica — isso ajusta o fator
   de UA e define a linha de base.
3. A partir daí, a queda do índice de saúde (UA medido ÷ UA previsto) indica degradação
   real: obstrução de aletas, incrustação ou fluido degradado.

Sem essa linha de base, a regra de perda de desempenho fica inativa: um limiar absoluto
sobre um UA teórico enviesado só produziria falso positivo.

## Coletas de demonstração

A aba de importação gera duas coletas sintéticas, para validar a plataforma antes da
primeira campanha real:

- **Coleta 01 — radiador nominal**: ciclo urbano + rodovia + congestionamento, 30 min.
- **Coleta 02 — radiador com obstrução**: mesmo ciclo com 54% de perda de UA e
  eletroventilador enfraquecido; a temperatura cruza o limite crítico e a detecção de
  anomalia dispara.

Ambas são produzidas por um modelo de capacitância concentrada acoplado ao modelo ε–NTU,
com o mesmo ruído e a mesma resolução dos sensores previstos (OBD-II 1 °C, DS18B20
0,0625 °C). **São dados simulados, e a interface avisa isso em todas as telas.**

## Estrutura

```
index.html                 página única com todas as abas

assets/css/app.css         tokens dos dois modos e biblioteca de componentes
assets/css/speed.css       peças exclusivas do speed mode (boot, cluster, ECU, dyno)

assets/js/util.js          utilitários, formatação pt-BR, armazenamento local
assets/js/motion.js        integrador de molas: inclinação, toque, cursor das abas, contagem
assets/js/audio.js         sons da interface sintetizados em WebAudio (desligado por padrão)
assets/js/thermal.js       propriedades dos fluidos, correlações, ε–NTU, calibração
assets/js/csvio.js         leitura de CSV, detecção de colunas, sincronização, auditoria
assets/js/charts.js        gráficos em canvas: séries, dispersão, barras, mostradores, razões, superfície 3D
assets/js/model.js         regressão ridge, validação cruzada, anomalias, alertas
assets/js/demo.js          gerador de coletas sintéticas
assets/js/explain.js       a aba "Entenda o cálculo": esquema, memória de cálculo, superfície 3D
assets/js/tasks.js         itens pendentes do projeto, marcáveis e guardados no navegador
assets/js/tune.js          mapas da bancada de remapeamento e o motor de mentira por trás
assets/js/speed.js         speed mode: partida da ECU, cluster, telas da central, dinamômetro
assets/js/cmdk.js          paleta de comandos (Ctrl+K)
assets/js/app.js           interface, estado, relatório

assets/img/                logo, wordmark e favicon
docs/PROJETO.md            formulário da disciplina e cronograma
```

Os módulos de cálculo (`thermal`, `csvio`, `model`, `demo`) não sabem que a interface
existe. Os módulos de apresentação (`explain`, `speed`, `cmdk`) leem o estado por uma
superfície só, `ATC.App`, em vez de alcançar variáveis internas do `app.js`.

## Movimento

Nada na interface tem duração fixa. Tudo que se mexe passa por `motion.js`, que integra
uma mola de verdade:

```
a = −k(x − alvo) − c·v      v += a·dt      x += v·dt
```

Interromper um movimento no meio não corta nada: a velocidade que o elemento já tinha
entra no trecho seguinte. Um único `requestAnimationFrame` serve todos os assinantes e é
cancelado quando nada mais se move, então o custo em repouso é zero. Cada quadro escreve
apenas variáveis CSS que alimentam `transform` e `opacity` — sem layout, sem repaint, o
compositor resolve. É o que sustenta os 60 fps.

Quem tiver *reduzir movimento* ligado no sistema recebe a interface sem inclinação, sem
partículas e sem a sequência de partida — os estados continuam todos alcançáveis.

## A superfície 3D

Calor rejeitado não depende de uma variável só: depende da velocidade do carro **e** da
rotação do motor ao mesmo tempo. Duas variáveis não cabem numa curva — cabem numa
superfície, e mostrar superfície como superfície poupa a conversa inteira de "imagine
várias curvas sobrepostas".

O renderizador é próprio, sem biblioteca, e monta a figura como um gráfico de artigo:

- **paredes de fundo** com grade, escolhidas pelo giro — sempre as duas que ficam atrás;
- **eixo vertical** na quina que aparece mais à esquerda, com marcas e escala;
- **malha** sobre a superfície, que é o que deixa a inclinação legível;
- **curvas de nível projetadas na base**, que fica um degrau abaixo do vale — sem essa
  folga elas ficariam debaixo do próprio relevo;
- **barra de cores** com escala e unidade, ao lado do desenho.

Cada quadrilátero é sombreado pela própria inclinação contra uma luz direcional, que é o
que faz o relevo aparecer — mais do que a cor. Arraste para girar; ao soltar, a superfície
sai girando por inércia e para sozinha por atrito. Custa **3,8 ms por quadro** com tudo
ligado, folga de sobra para os 60 fps.

Em tela estreita a figura se reorganiza sozinha: a barra de cores sai, a escala rareia, o
título encolhe até caber e o subtítulo só aparece se couber inteiro — meia frase cortada
não informa nada.

Os seis parâmetros que mais mandam no resultado ficam em controles ao lado. Mexer neles
deforma a superfície na hora, mas **não encosta na análise**: é uma caixa de areia até
alguém clicar em *Aplicar de verdade*. Mexer num controle para entender não pode
reescrever a memória de cálculo de uma coleta real.

Duas decisões saíram de medição, não de gosto:

- **O painel de instrumentos desenha a face uma vez.** Trilha, escala, números e o nome de
  cada mostrador vão para um canvas fora da tela e são copiados por quadro. Só o arco de
  valor, o ponteiro e a leitura digital são redesenhados.
- **Rótulo nenhum briga com a geometria.** Girar a superfície coloca qualquer rótulo em
  cima do relevo mais cedo ou mais tarde. Em vez de disputar espaço, cada rótulo leva a
  própria pastilha de fundo, a escala é escrita na borda que aparece mais embaixo na tela
  e as pastilhas que colidiriam com o nome de um eixo são simplesmente omitidas.
- **Vidro só onde o fundo fica parado.** `backdrop-filter` obriga o navegador a refazer o
  desfoque sempre que qualquer coisa atrás muda; com o cluster desenhando a 60 Hz, o
  desfoque nos painéis custava 34 dos 60 quadros por segundo (medido: 27 fps com, 61 fps
  sem). Os painéis passaram a usar cor translúcida, que no escuro lê igual e não custa
  nada. O desfoque de verdade ficou no cabeçalho e na paleta de comandos, que flutuam
  sobre conteúdo estático.

## Itens pendentes

Ver a aba **Projeto** ou [`docs/PROJETO.md`](docs/PROJETO.md): nome da equipe no
formulário, integrantes e suas funções, turma e professor(a), prazos, modelo do scanner
adquirido e acesso a laboratório.
