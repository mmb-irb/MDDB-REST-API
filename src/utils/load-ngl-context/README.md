We are using NGL to transform a user selection into an atom range.
Since NGL expects to be running in a browser, a certain amount of changes have
to be made on the global scope (which might interact with other part of the
server's logic, or with other requests). Also, I'm not completely confident
multiple calls to NGL with different PDB files and selection strings might not
interact with each other.

So:

As a way to sandbox this logic, I'm creating a one-off Worker thread for every
such queries.

It is not necessarily to make the logic faster or to free-up the main thread.
