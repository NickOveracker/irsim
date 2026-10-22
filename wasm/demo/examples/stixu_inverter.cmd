| Inverter, exported from Stixu as IRSIM commands.
alias Y e4 
alias A e3 
alias e2 vdd
alias e5 gnd
h vdd
l gnd
stepsize 50
ana A Y
l A
s
d Y
h A
s
d Y
