#!/bin/sh
# Replace placeholder password with actual DB password from environment
sed -i "s/PGBOUNCER_PASSWORD_PLACEHOLDER/${DB_PASSWORD:-parallext_secret}/" /etc/pgbouncer/userlist.txt
exec pgbouncer /etc/pgbouncer/pgbouncer.ini
