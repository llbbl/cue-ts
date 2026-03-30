age: int & >=0 & <150
name: string & =~"^[A-Z]"
role: "admin" | "user" | "guest"
status: int | string
port: int & >=1 & <=65535
