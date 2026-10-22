| 4x4 multiplier (sized for speed): p = a * b, most significant bit first.
h VDD
l GND
stepsize 50
vector a A B C D
vector b E F G H
vector p R S T U V W X Y
ana a b p
set a 0000
set b 0000
s
set a 0011
set b 0101
s
set a 0111
set b 0110
s
set a 1001
set b 1011
s
set a 1100
set b 1101
s
set a 1111
set b 1111
s
set a 1010
set b 0101
s
