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
| **Importar dados** | Lê o CSV do scanner OBD-II e o do logger de temperatura, detecta as colunas e sincroniza as duas fontes |
| **Análise térmica** | Balanço de energia, efetividade–NTU, UA, resultados por regime e calibração do modelo |
| **Previsão (IA)** | Treina e valida o modelo de previsão de temperatura; detecta anomalias |
| **Alertas** | Alertas preditivos e medição da antecedência conseguida |
| **Relatório** | Relatório técnico da coleta, exportável em PDF, CSV e JSON |
| **Projeto** | Escopo, ementa, método, riscos e itens pendentes |

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
index.html                 página única com as sete abas
assets/css/app.css         design system
assets/js/util.js          utilitários, formatação pt-BR, armazenamento local
assets/js/thermal.js       propriedades dos fluidos, correlações, ε–NTU, calibração
assets/js/csvio.js         leitura de CSV, detecção de colunas, sincronização, auditoria
assets/js/charts.js        gráficos em canvas
assets/js/model.js         regressão ridge, validação cruzada, anomalias, alertas
assets/js/demo.js          gerador de coletas sintéticas
assets/js/app.js           interface, estado, relatório
assets/img/                logo, wordmark e favicon
docs/PROJETO.md            formulário da disciplina e cronograma
```

## Itens pendentes

Ver a aba **Projeto** ou [`docs/PROJETO.md`](docs/PROJETO.md): nome da equipe no
formulário, integrantes e suas funções, turma e professor(a), prazos, modelo do scanner
adquirido e acesso a laboratório.
