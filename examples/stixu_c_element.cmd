| C-element demo, exported from Stixu as IRSIM commands.
alias Y e10 
alias A e3 
alias B e5 
alias C e2 
alias e7 vdd
alias e9 gnd
h vdd
l gnd
stepsize 50
ana A B C Y
l A
l B
l C
s
d A B C Y
h A
h B
h C
s
d A B C Y
l A
h B
h C
s
d A B C Y
l A
l B
h C
s
d A B C Y
l A
l B
l C
s
d A B C Y
h A
l B
l C
s
d A B C Y
h A
h B
l C
s
d A B C Y
h A
h B
h C
s
d A B C Y
