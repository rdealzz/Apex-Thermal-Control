# Apex Thermal Control — formulário da disciplina

**Título técnico:** Análise térmica do radiador automotivo com monitoramento e previsão de
temperatura
**Disciplina:** Transferência de Calor — UniCuritiba
**Bancada:** Chevrolet Cruze LT 1.8 (2016), veículo próprio, instrumentado

---

## 01 — Identificação

| Campo | Valor |
| --- | --- |
| Nome da equipe | Apex Thermal Control |
| Integrantes | **a confirmar** — o formulário pede função, competência principal e disponibilidade semanal de cada um |
| Turma / período | **a confirmar** |
| Professor(a) | **a confirmar** |
| Data da aula | **a confirmar** |
| Prazo da primeira entrega | **a confirmar** |
| Data da entrega seguinte | **a confirmar** |

## 02 — Problema e produto

**Problema real.** O sistema de arrefecimento veicular opera de forma reativa: o
eletroventilador só é acionado quando o líquido já atingiu o setpoint. Não existe previsão
de tendência térmica nem indicador de perda de desempenho do radiador — obstrução de
aletas, incrustação interna, fluido degradado — e a falha só se manifesta quando ocorre o
superaquecimento.

**Usuário ou aplicação.** Motoristas de veículos leves e oficinas de manutenção
preventiva; extensível à gestão de frotas.

**Produto proposto.** Aplicativo (dashboard web) e estudo técnico: análise térmica do
radiador acoplada ao monitoramento.

**Benefício esperado.** Antecipar o superaquecimento em minutos, permitir manutenção
preditiva do radiador e quantificar sua efetividade real em operação.

## 03 — Núcleo da ementa

**Núcleo principal:** trocadores de calor — efetividade–NTU.
**Núcleo associado:** convecção natural e forçada.

**Conteúdos mobilizados**

- Primeira lei da termodinâmica em volume de controle
- Balanço de energia em regime permanente
- Trocador de calor de escoamento cruzado
- Coeficiente global de transferência de calor (UA)
- Método efetividade–NTU e sua inversão numérica
- Convecção forçada externa (Re, Pr, Nu)
- Resistências térmicas em série

**Fenômeno físico principal:** convecção; trocador de calor.

**Variáveis principais:** temperatura, vazão, potência térmica, NTU e efetividade; mais
rotação do motor, velocidade do veículo e carga do motor como variáveis de operação.

## 04 — Produto e método

**Escopo mínimo viável.** Coletar séries temporais reais via OBD-II no veículo próprio,
armazenar, calcular o calor rejeitado e a efetividade do radiador pelo método ε–NTU e
apresentar os resultados em gráficos e relatórios na plataforma. A previsão por IA é a
extensão: se não for concluída, o estudo térmico e o dashboard já se sustentam como
entrega.

**Método térmico.** Balanço de energia e efetividade–NTU, com Nusselt como apoio.

**Equações.** Ver a seção *Método* do [README](../README.md) e a aba **Análise térmica** da
plataforma, que mostra as equações usadas ao lado dos resultados.

**Dados necessários**

| Item | Origem |
| --- | --- |
| Temperatura do líquido de arrefecimento | PID `0105` |
| Rotação do motor | PID `010C` |
| Velocidade do veículo | PID `010D` |
| Carga calculada do motor | PID `0104` |
| Temperatura do ar de admissão | PID `010F` |
| Temperatura ambiente | sensor dedicado, fora do compartimento do motor |
| T entrada e saída do radiador | 2× DS18B20 nas mangueiras superior e inferior |
| Geometria do núcleo do radiador | medição direta |
| Vazão da bomba | estimada em função da rotação; medir se houver vazonômetro |
| Propriedades do fluido | mistura água/etilenoglicol 50/50 |

**Recursos disponíveis.** Sensores, simulação, dados externos e o veículo próprio como
bancada real. Laboratório da UniCuritiba (termopar, multímetro, termômetro infravermelho,
fonte) e microcontrolador — **a confirmar**.

## 05 — IA e validação

**Função da IA.** Previsão de temperatura e detecção de anomalias.

**Entradas do modelo.** Janela deslizante das últimas leituras: temperatura atual do
líquido, tendências de 60 s e 180 s, rotação, velocidade, carga, temperatura do ar de
admissão, temperatura ambiente, tempo de motor ligado, ciclo do ventilador, calor
rejeitado, efetividade, abertura do termostato, calor gerado pelo motor, desequilíbrio
térmico e a variação prevista pelo modelo físico de capacitância concentrada.

**Saídas.** Temperatura prevista do líquido no horizonte configurado (padrão 5 min),
recomendação de acionamento antecipado do ventilador e sinalização de anomalia por queda
de efetividade.

**Validação.** Comparação ideal × real e abordagem híbrida: dados experimentais de rodagem
contra o modelo analítico ε–NTU. Validação cruzada em blocos contíguos, sem embaralhar a
série temporal, mais um holdout do último trecho da sessão.

**Métricas de sucesso.** Erro (MAE, RMSE) e efetividade.

**Critérios de aprovação técnica**

1. MAE ≤ 2 °C na previsão do horizonte em dados não vistos
2. Efetividade coerente com a faixa de referência de radiadores automotivos de fluxo
   cruzado (0,40–0,70)
3. Alerta emitido com pelo menos 2 min de antecedência ao limite crítico

## 06 — Riscos, segurança e plano inicial

**Risco técnico principal.** O OBD-II fornece apenas a temperatura de entrada do líquido,
com resolução de 1 °C, e não a temperatura de saída do radiador. Sem ΔT não se fecha o
balanço de energia.

*Mitigação:* instalar dois sensores (DS18B20 ou termopar tipo K) nas mangueiras superior e
inferior, ou medir com termômetro infravermelho em pontos fixos e horários controlados. A
plataforma trata os dois casos e rotula explicitamente quando o resultado é estimativa em
vez de medição.

**Riscos de segurança.** Alta temperatura; fluido refrigerante sob pressão; partes móveis;
eletricidade.

**Como reduzir**

- Nunca abrir o sistema com o motor quente ou pressurizado
- Medições no compartimento do motor com motor desligado, ou com o veículo parado e o
  eletroventilador travado
- Coleta durante a condução feita por um segundo integrante ou por logger automático — sem
  manipular o notebook ao volante

**Primeira tarefa após a aula.** Validar o scanner no veículo, levantar quais PIDs o Cruze
responde e gravar a primeira sessão de log de 30 minutos em ciclo urbano mais rodovia.

## Riscos de disponibilidade da bancada

1. **Venda do veículo.** O Cruze é a bancada de todo o projeto e está anunciado para venda.
   Se sair antes das campanhas de coleta, é preciso um veículo substituto — o método
   funciona em qualquer carro com OBD-II, mas a geometria do radiador e a vazão da bomba
   têm de ser levantadas de novo.
2. **Painel de instrumentos.** Os ponteiros de rotação e velocidade pararam de funcionar,
   o que pode indicar problema no barramento CAN ou no cluster. Se os PIDs `010C` e `010D`
   vierem zerados ou ausentes, a rotação passa a vir do próprio scanner por outro PID e a
   velocidade, do GPS do celular. **Testar isso antes de fechar o escopo:** rotação e
   velocidade são entradas centrais do cálculo de vazão.

## Cronograma

| Semana | Entregável |
| --- | --- |
| 1 | Validação do scanner no veículo e levantamento dos PIDs que o Cruze responde; primeira sessão de log de 30 min (urbano + rodovia) |
| 2 | Medição da geometria do núcleo do radiador; instrumentação das mangueiras com DS18B20; primeira coleta com ΔT medido |
| 3 | Calibração do modelo contra a coleta de linha de base; análise ε–NTU por regime |
| 4 | Treino e validação do modelo de previsão; verificação dos três critérios de aprovação |
| 5 | Campanha de coleta em condições variadas (dias, temperaturas, trajetos) |
| 6 | Memória de cálculo, relatório final e apresentação |

## Itens pendentes de confirmação

- [ ] Nome da equipe registrado no formulário (a plataforma adota *Apex Thermal Control*)
- [ ] Número de integrantes e, para cada um, função, competência principal e
      disponibilidade semanal
- [ ] Turma/período, professor(a) responsável e data da aula
- [ ] Prazo da primeira entrega e data da entrega seguinte
- [ ] Modelo do scanner OBD-II adquirido
- [ ] Acesso a laboratório da UniCuritiba: termopar, multímetro, termômetro infravermelho,
      fonte
