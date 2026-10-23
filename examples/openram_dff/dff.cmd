| OpenRAM's flip-flop: Q takes D at each rising edge of clk.
| Simulated with tsmc35.20.n98t.3.3, the parameters for the TSMC 0.35 um process this
| technology targets; the web app runs this file when the example loads.
h vdd
l gnd
stepsize 5
clock clk 0 1
ana clk D Q
h D
c
d Q
l D
c
d Q
h D
c
d Q
