/**
 * Bases de datos de ejemplo del curso de SQL. Cada una es un guion SQL que se ejecuta al abrir un ejercicio.
 * Los datos están pensados para enseñar: hay NULL, repetidos, empates, fechas, clientes sin pedidos, etc.
 */

export interface Dataset {
  id: string;
  title: string;
  emoji: string;
  blurb: string;
  script: string;
}

const tienda = `
CREATE TABLE clientes (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  ciudad TEXT,
  email TEXT UNIQUE,
  fecha_alta DATE NOT NULL,
  vip BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE productos (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL,
  precio REAL NOT NULL CHECK (precio > 0),
  stock INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE pedidos (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  fecha DATE NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'enviado', 'entregado', 'cancelado'))
);
CREATE TABLE detalle_pedido (
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  PRIMARY KEY (pedido_id, producto_id)
);
INSERT INTO clientes (id, nombre, ciudad, email, fecha_alta, vip) VALUES
  (1, 'Ana García', 'Madrid', 'ana@mail.com', '2023-01-15', true),
  (2, 'Luis Martín', 'Sevilla', 'luis@mail.com', '2023-02-20', false),
  (3, 'Marta López', 'Madrid', 'marta@mail.com', '2023-03-05', true),
  (4, 'Pablo Ruiz', NULL, NULL, '2023-04-12', false),
  (5, 'Lucía Fernández', 'Barcelona', 'lucia@mail.com', '2023-05-30', true),
  (6, 'Diego Sánchez', 'Valencia', 'diego@mail.com', '2023-06-18', false),
  (7, 'Carmen Díaz', 'Sevilla', 'carmen@mail.com', '2023-07-02', false),
  (8, 'Javier Moreno', 'Madrid', 'javier@mail.com', '2023-09-09', false),
  (9, 'Elena Torres', 'Bilbao', 'elena@mail.com', '2023-10-21', true),
  (10, 'Sergio Navarro', 'Barcelona', 'sergio@mail.com', '2023-11-11', false),
  (11, 'Laura Gil', NULL, 'laura@mail.com', '2024-01-08', false),
  (12, 'Raúl Ortega', 'Zaragoza', 'raul@mail.com', '2024-02-14', false);
INSERT INTO productos (id, nombre, categoria, precio, stock) VALUES
  (1, 'Teclado mecánico', 'perifericos', 79.90, 25),
  (2, 'Ratón inalámbrico', 'perifericos', 24.50, 60),
  (3, 'Monitor 27 pulgadas', 'pantallas', 249.00, 12),
  (4, 'Monitor 24 pulgadas', 'pantallas', 159.99, 18),
  (5, 'Portátil Pro 15', 'ordenadores', 1299.00, 5),
  (6, 'Portátil Air 13', 'ordenadores', 999.00, 8),
  (7, 'Auriculares Bluetooth', 'audio', 59.90, 40),
  (8, 'Altavoz portátil', 'audio', 34.95, 0),
  (9, 'Webcam HD', 'perifericos', 39.00, 22),
  (10, 'Cable HDMI 2m', 'accesorios', 7.50, 200),
  (11, 'Hub USB-C', 'accesorios', 29.90, 45),
  (12, 'Alfombrilla XL', 'accesorios', 12.00, 80),
  (13, 'Tablet 10 pulgadas', 'ordenadores', 329.00, 9),
  (14, 'Funda para portátil', 'accesorios', 19.90, 35);
INSERT INTO pedidos (id, cliente_id, fecha, estado) VALUES
  (1, 1, '2024-01-10', 'entregado'),
  (2, 1, '2024-02-03', 'entregado'),
  (3, 2, '2024-02-14', 'entregado'),
  (4, 3, '2024-03-01', 'cancelado'),
  (5, 3, '2024-03-18', 'entregado'),
  (6, 5, '2024-03-22', 'entregado'),
  (7, 6, '2024-04-02', 'entregado'),
  (8, 1, '2024-04-15', 'enviado'),
  (9, 7, '2024-04-20', 'entregado'),
  (10, 9, '2024-05-05', 'entregado'),
  (11, 5, '2024-05-11', 'enviado'),
  (12, 2, '2024-05-29', 'pendiente'),
  (13, 8, '2024-06-02', 'entregado'),
  (14, 10, '2024-06-14', 'entregado'),
  (15, 3, '2024-06-30', 'enviado'),
  (16, 9, '2024-07-07', 'entregado'),
  (17, 1, '2024-07-19', 'pendiente'),
  (18, 6, '2024-08-01', 'cancelado'),
  (19, 5, '2024-08-23', 'entregado'),
  (20, 11, '2024-09-04', 'enviado'),
  (21, 7, '2024-09-17', 'pendiente'),
  (22, 10, '2024-10-02', 'entregado'),
  (23, 4, '2024-10-15', 'pendiente'),
  (24, 9, '2024-11-03', 'pendiente');
INSERT INTO detalle_pedido (pedido_id, producto_id, cantidad) VALUES
  (1, 1, 1), (1, 2, 1),
  (2, 3, 1),
  (3, 7, 2), (3, 10, 3),
  (4, 5, 1),
  (5, 4, 2), (5, 2, 2),
  (6, 6, 1), (6, 11, 1),
  (7, 9, 1), (7, 12, 2),
  (8, 13, 1),
  (9, 7, 1), (9, 14, 1),
  (10, 5, 1), (10, 1, 1), (10, 10, 2),
  (11, 3, 2),
  (12, 8, 1), (12, 10, 5),
  (13, 2, 1),
  (14, 4, 1), (14, 1, 1),
  (15, 11, 2), (15, 12, 1),
  (16, 6, 1),
  (17, 9, 2), (17, 7, 1),
  (18, 13, 1),
  (19, 3, 1), (19, 2, 1), (19, 10, 1),
  (20, 14, 2),
  (21, 1, 1), (21, 12, 3),
  (22, 7, 1), (22, 11, 1),
  (23, 10, 4),
  (24, 4, 1), (24, 9, 1);
`;

const cine = `
CREATE TABLE directores (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  pais TEXT NOT NULL,
  nacimiento INTEGER
);
CREATE TABLE peliculas (
  id INTEGER PRIMARY KEY,
  titulo TEXT NOT NULL,
  anio INTEGER NOT NULL,
  genero TEXT NOT NULL,
  duracion INTEGER NOT NULL,
  puntuacion REAL,
  director_id INTEGER REFERENCES directores(id)
);
CREATE TABLE actores (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  pais TEXT
);
CREATE TABLE reparto (
  pelicula_id INTEGER NOT NULL REFERENCES peliculas(id),
  actor_id INTEGER NOT NULL REFERENCES actores(id),
  personaje TEXT NOT NULL,
  PRIMARY KEY (pelicula_id, actor_id)
);
INSERT INTO directores (id, nombre, pais, nacimiento) VALUES
  (1, 'Alejandro Amenábar', 'España', 1972),
  (2, 'Pedro Almodóvar', 'España', 1949),
  (3, 'Guillermo del Toro', 'México', 1964),
  (4, 'Christopher Nolan', 'Reino Unido', 1970),
  (5, 'Greta Gerwig', 'Estados Unidos', 1983),
  (6, 'Bong Joon-ho', 'Corea del Sur', 1969),
  (7, 'Isabel Coixet', 'España', 1960);
INSERT INTO peliculas (id, titulo, anio, genero, duracion, puntuacion, director_id) VALUES
  (1, 'Los otros', 2001, 'terror', 104, 7.6, 1),
  (2, 'Mar adentro', 2004, 'drama', 125, 8.0, 1),
  (3, 'Todo sobre mi madre', 1999, 'drama', 101, 7.9, 2),
  (4, 'Volver', 2006, 'drama', 121, 7.6, 2),
  (5, 'El laberinto del fauno', 2006, 'fantasia', 119, 8.2, 3),
  (6, 'La forma del agua', 2017, 'fantasia', 123, 7.3, 3),
  (7, 'Origen', 2010, 'ciencia ficcion', 148, 8.8, 4),
  (8, 'Interstellar', 2014, 'ciencia ficcion', 169, 8.7, 4),
  (9, 'Oppenheimer', 2023, 'drama', 180, 8.3, 4),
  (10, 'Lady Bird', 2017, 'comedia', 94, 7.4, 5),
  (11, 'Barbie', 2023, 'comedia', 114, 6.8, 5),
  (12, 'Parásitos', 2019, 'thriller', 132, 8.5, 6),
  (13, 'Memorias de un asesino', 2003, 'thriller', 131, 8.1, 6),
  (14, 'Mi vida sin mí', 2003, 'drama', 106, 7.4, 7),
  (15, 'Tesis', 1996, 'thriller', 125, 7.4, 1),
  (16, 'Película sin estrenar', 2025, 'drama', 100, NULL, NULL);
INSERT INTO actores (id, nombre, pais) VALUES
  (1, 'Javier Bardem', 'España'),
  (2, 'Penélope Cruz', 'España'),
  (3, 'Cillian Murphy', 'Irlanda'),
  (4, 'Margot Robbie', 'Australia'),
  (5, 'Saoirse Ronan', 'Irlanda'),
  (6, 'Song Kang-ho', 'Corea del Sur'),
  (7, 'Nicole Kidman', 'Australia'),
  (8, 'Matthew McConaughey', 'Estados Unidos'),
  (9, 'Leonardo DiCaprio', 'Estados Unidos'),
  (10, 'Marisa Paredes', 'España'),
  (11, 'Ryan Gosling', 'Canadá');
INSERT INTO reparto (pelicula_id, actor_id, personaje) VALUES
  (1, 7, 'Grace'),
  (2, 1, 'Ramón Sampedro'),
  (3, 2, 'Huma Rojo'),
  (3, 10, 'Manuela'),
  (4, 2, 'Raimunda'),
  (4, 10, 'Agustina'),
  (5, 10, 'Madre'),
  (7, 9, 'Cobb'),
  (7, 3, 'Robert Fischer'),
  (8, 8, 'Cooper'),
  (9, 3, 'Oppenheimer'),
  (10, 5, 'Lady Bird'),
  (11, 4, 'Barbie'),
  (11, 11, 'Ken'),
  (12, 6, 'Kim Ki-taek'),
  (13, 6, 'Park Doo-man');
`;

const escuela = `
CREATE TABLE profesores (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  departamento TEXT NOT NULL
);
CREATE TABLE alumnos (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  curso INTEGER NOT NULL,
  ciudad TEXT,
  fecha_nac DATE NOT NULL
);
CREATE TABLE asignaturas (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  creditos INTEGER NOT NULL,
  profesor_id INTEGER REFERENCES profesores(id)
);
CREATE TABLE matriculas (
  alumno_id INTEGER NOT NULL REFERENCES alumnos(id),
  asignatura_id INTEGER NOT NULL REFERENCES asignaturas(id),
  nota REAL,
  convocatoria INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (alumno_id, asignatura_id)
);
INSERT INTO profesores (id, nombre, departamento) VALUES
  (1, 'Dra. Ortiz', 'Matemáticas'),
  (2, 'Dr. Vega', 'Informática'),
  (3, 'Dra. Prieto', 'Lengua'),
  (4, 'Dr. Campos', 'Física');
INSERT INTO alumnos (id, nombre, curso, ciudad, fecha_nac) VALUES
  (1, 'Sofía Rubio', 1, 'Madrid', '2006-03-14'),
  (2, 'Mateo Blanco', 1, 'Sevilla', '2005-11-02'),
  (3, 'Valeria Marín', 2, 'Madrid', '2005-07-21'),
  (4, 'Hugo Castro', 2, NULL, '2004-12-30'),
  (5, 'Daniela Soto', 2, 'Valencia', '2005-01-09'),
  (6, 'Álvaro Peña', 3, 'Bilbao', '2004-05-25'),
  (7, 'Irene Cano', 3, 'Madrid', '2004-09-17'),
  (8, 'Marcos Vidal', 3, 'Sevilla', '2003-10-03'),
  (9, 'Noa Herrera', 1, 'Valencia', '2006-06-06'),
  (10, 'Pol Ferrer', 2, 'Barcelona', '2005-02-28');
INSERT INTO asignaturas (id, nombre, creditos, profesor_id) VALUES
  (1, 'Cálculo', 6, 1),
  (2, 'Programación', 6, 2),
  (3, 'Bases de datos', 4, 2),
  (4, 'Física', 6, 4),
  (5, 'Literatura', 3, 3),
  (6, 'Estadística', 4, 1),
  (7, 'Ética', 2, NULL);
INSERT INTO matriculas (alumno_id, asignatura_id, nota, convocatoria) VALUES
  (1, 1, 7.5, 1), (1, 2, 9.0, 1), (1, 5, 6.0, 1),
  (2, 1, 4.5, 1), (2, 2, 5.5, 2), (2, 3, 8.0, 1),
  (3, 2, 9.5, 1), (3, 3, 9.0, 1), (3, 6, 7.0, 1),
  (4, 1, 3.0, 1), (4, 4, NULL, 1), (4, 6, 5.0, 2),
  (5, 2, 8.0, 1), (5, 3, 7.5, 1), (5, 5, 8.5, 1),
  (6, 3, 6.5, 1), (6, 4, 7.0, 1), (6, 6, 9.0, 1),
  (7, 1, 8.5, 1), (7, 2, 10.0, 1), (7, 3, 9.5, 1), (7, 4, 8.0, 1),
  (8, 4, 5.0, 1), (8, 6, 6.0, 1),
  (9, 1, 6.5, 1), (9, 5, 7.0, 1),
  (10, 2, 7.5, 1), (10, 3, 5.0, 1), (10, 6, NULL, 1);
`;

const empresa = `
CREATE TABLE departamentos (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  ciudad TEXT NOT NULL
);
CREATE TABLE empleados (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  cargo TEXT NOT NULL,
  salario REAL NOT NULL,
  fecha_ingreso DATE NOT NULL,
  departamento_id INTEGER REFERENCES departamentos(id),
  jefe_id INTEGER REFERENCES empleados(id)
);
CREATE TABLE proyectos (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  presupuesto REAL NOT NULL
);
CREATE TABLE asignaciones (
  empleado_id INTEGER NOT NULL REFERENCES empleados(id),
  proyecto_id INTEGER NOT NULL REFERENCES proyectos(id),
  horas INTEGER NOT NULL,
  PRIMARY KEY (empleado_id, proyecto_id)
);
INSERT INTO departamentos (id, nombre, ciudad) VALUES
  (1, 'Dirección', 'Madrid'),
  (2, 'Tecnología', 'Madrid'),
  (3, 'Ventas', 'Barcelona'),
  (4, 'Recursos Humanos', 'Madrid'),
  (5, 'Marketing', 'Valencia');
INSERT INTO empleados (id, nombre, cargo, salario, fecha_ingreso, departamento_id, jefe_id) VALUES
  (1, 'Carolina Vega', 'Directora general', 6500, '2015-03-01', 1, NULL),
  (2, 'Andrés Molina', 'Director de tecnología', 5200, '2016-06-15', 2, 1),
  (3, 'Beatriz Sanz', 'Directora de ventas', 4800, '2017-01-10', 3, 1),
  (4, 'Cristian Lara', 'Desarrollador sénior', 3900, '2018-09-03', 2, 2),
  (5, 'Daniela Pons', 'Desarrolladora', 3200, '2020-02-17', 2, 4),
  (6, 'Esteban Gil', 'Desarrollador', 3100, '2021-05-24', 2, 4),
  (7, 'Fátima Ríos', 'Analista de datos', 3500, '2019-11-04', 2, 2),
  (8, 'Gonzalo Mora', 'Comercial', 2800, '2019-04-22', 3, 3),
  (9, 'Helena Cruz', 'Comercial', 2900, '2020-10-12', 3, 3),
  (10, 'Ismael Vera', 'Comercial', 2700, '2022-01-31', 3, 3),
  (11, 'Julia Navas', 'Responsable de RRHH', 4100, '2017-07-19', 4, 1),
  (12, 'Kevin Soler', 'Técnico de RRHH', 2600, '2022-09-05', 4, 11),
  (13, 'Lorena Paz', 'Directora de marketing', 4400, '2018-03-12', 5, 1),
  (14, 'Mario Bravo', 'Diseñador', 2900, '2021-08-30', 5, 13),
  (15, 'Nuria Ferrer', 'Desarrolladora', 3200, '2023-02-06', 2, 4),
  (16, 'Óscar Lozano', 'Becario', 1200, '2024-03-04', NULL, 4);
INSERT INTO proyectos (id, nombre, presupuesto) VALUES
  (1, 'Nueva web', 80000),
  (2, 'App móvil', 120000),
  (3, 'Plataforma de datos', 150000),
  (4, 'Campaña de verano', 40000),
  (5, 'Migración a la nube', 95000);
INSERT INTO asignaciones (empleado_id, proyecto_id, horas) VALUES
  (4, 1, 120), (4, 2, 200), (4, 5, 80),
  (5, 1, 150), (5, 2, 180),
  (6, 2, 220), (6, 5, 60),
  (7, 3, 300), (7, 5, 40),
  (14, 1, 90), (14, 4, 160),
  (13, 4, 100),
  (15, 3, 140), (15, 2, 50),
  (2, 5, 70), (2, 3, 60),
  (8, 4, 30);
`;

const biblioteca = `
CREATE TABLE autores (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  pais TEXT NOT NULL,
  nacimiento INTEGER
);
CREATE TABLE libros (
  id INTEGER PRIMARY KEY,
  titulo TEXT NOT NULL,
  autor_id INTEGER NOT NULL REFERENCES autores(id),
  anio INTEGER,
  genero TEXT NOT NULL,
  paginas INTEGER NOT NULL,
  ejemplares INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE socios (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT,
  fecha_alta DATE NOT NULL
);
CREATE TABLE prestamos (
  id INTEGER PRIMARY KEY,
  libro_id INTEGER NOT NULL REFERENCES libros(id),
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  fecha_prestamo DATE NOT NULL,
  fecha_devolucion DATE
);
INSERT INTO autores (id, nombre, pais, nacimiento) VALUES
  (1, 'Gabriel García Márquez', 'Colombia', 1927),
  (2, 'Isabel Allende', 'Chile', 1942),
  (3, 'Jorge Luis Borges', 'Argentina', 1899),
  (4, 'Carmen Laforet', 'España', 1921),
  (5, 'Julio Cortázar', 'Argentina', 1914),
  (6, 'Rosa Montero', 'España', 1951),
  (7, 'Autor desconocido', 'Desconocido', NULL);
INSERT INTO libros (id, titulo, autor_id, anio, genero, paginas, ejemplares) VALUES
  (1, 'Cien años de soledad', 1, 1967, 'novela', 471, 3),
  (2, 'El amor en los tiempos del cólera', 1, 1985, 'novela', 368, 2),
  (3, 'Crónica de una muerte anunciada', 1, 1981, 'novela', 122, 2),
  (4, 'La casa de los espíritus', 2, 1982, 'novela', 433, 2),
  (5, 'Paula', 2, 1994, 'memorias', 330, 1),
  (6, 'Ficciones', 3, 1944, 'cuentos', 174, 2),
  (7, 'El Aleph', 3, 1949, 'cuentos', 160, 1),
  (8, 'Nada', 4, 1945, 'novela', 304, 1),
  (9, 'Rayuela', 5, 1963, 'novela', 600, 2),
  (10, 'Bestiario', 5, 1951, 'cuentos', 120, 1),
  (11, 'La ridícula idea de no volver a verte', 6, 2013, 'memorias', 224, 1),
  (12, 'Tiempo de vida', 6, NULL, 'ensayo', 250, 1),
  (13, 'Poemas anónimos', 7, NULL, 'poesia', 90, 1);
INSERT INTO socios (id, nombre, email, fecha_alta) VALUES
  (1, 'Teresa Ibáñez', 'teresa@mail.com', '2022-01-10'),
  (2, 'Rubén Calvo', 'ruben@mail.com', '2022-03-22'),
  (3, 'Inés Garrido', NULL, '2022-06-15'),
  (4, 'Samuel Pardo', 'samuel@mail.com', '2023-01-05'),
  (5, 'Olga Benítez', 'olga@mail.com', '2023-04-18'),
  (6, 'Víctor Lara', NULL, '2023-09-30'),
  (7, 'Paula Soria', 'paula@mail.com', '2024-02-12');
INSERT INTO prestamos (id, libro_id, socio_id, fecha_prestamo, fecha_devolucion) VALUES
  (1, 1, 1, '2024-01-08', '2024-01-22'),
  (2, 6, 1, '2024-02-01', '2024-02-15'),
  (3, 9, 2, '2024-02-10', '2024-03-20'),
  (4, 4, 3, '2024-03-03', '2024-03-17'),
  (5, 1, 4, '2024-03-05', '2024-03-19'),
  (6, 8, 2, '2024-04-01', NULL),
  (7, 2, 5, '2024-04-09', '2024-04-30'),
  (8, 7, 1, '2024-05-12', '2024-05-26'),
  (9, 3, 4, '2024-05-20', NULL),
  (10, 5, 5, '2024-06-02', '2024-06-16'),
  (11, 1, 6, '2024-06-18', NULL),
  (12, 10, 3, '2024-07-01', '2024-07-15'),
  (13, 11, 7, '2024-07-04', '2024-07-18'),
  (14, 9, 4, '2024-08-12', NULL),
  (15, 6, 5, '2024-09-09', '2024-09-23');
`;

const social = `
CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY,
  alias TEXT NOT NULL UNIQUE,
  pais TEXT,
  registro DATE NOT NULL
);
CREATE TABLE publicaciones (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  texto TEXT NOT NULL,
  fecha TIMESTAMP NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE seguidores (
  seguidor_id INTEGER NOT NULL REFERENCES usuarios(id),
  seguido_id INTEGER NOT NULL REFERENCES usuarios(id),
  desde DATE NOT NULL,
  PRIMARY KEY (seguidor_id, seguido_id)
);
INSERT INTO usuarios (id, alias, pais, registro) VALUES
  (1, 'nube_azul', 'España', '2022-05-01'),
  (2, 'byte_ninja', 'México', '2022-06-12'),
  (3, 'luna_dev', 'Chile', '2022-08-30'),
  (4, 'dato_feliz', 'España', '2023-01-17'),
  (5, 'sql_fan', 'Argentina', '2023-03-02'),
  (6, 'codigo_zen', NULL, '2023-07-21'),
  (7, 'pixel_gato', 'España', '2024-01-09'),
  (8, 'recursiva', 'Colombia', '2024-02-20');
INSERT INTO publicaciones (id, usuario_id, texto, fecha, likes) VALUES
  (1, 1, 'Hoy empiezo con SQL', '2024-03-01 09:15:00', 12),
  (2, 1, 'Los JOIN no son tan difíciles', '2024-03-05 18:40:00', 30),
  (3, 2, 'Mi primer GROUP BY', '2024-03-06 12:00:00', 8),
  (4, 3, 'Ventanas: OVER y PARTITION BY', '2024-03-07 21:05:00', 45),
  (5, 3, 'Truco: usa CTE para leer mejor', '2024-03-12 08:30:00', 51),
  (6, 4, 'NULL no es cero', '2024-03-13 15:20:00', 22),
  (7, 5, 'Índices: cuándo sí y cuándo no', '2024-03-20 10:10:00', 60),
  (8, 5, 'EXPLAIN me salvó el día', '2024-03-21 19:45:00', 38),
  (9, 5, 'Gracias por los consejos', '2024-03-22 20:00:00', 5),
  (10, 6, 'Transacciones y ROLLBACK', '2024-04-02 11:11:00', 17),
  (11, 7, 'Mi gato escribió DELETE sin WHERE', '2024-04-03 09:00:00', 77),
  (12, 8, 'Recursividad: ver recursividad', '2024-04-10 14:30:00', 29);
INSERT INTO seguidores (seguidor_id, seguido_id, desde) VALUES
  (1, 3, '2022-09-01'), (1, 5, '2023-04-01'),
  (2, 1, '2022-07-01'), (2, 3, '2022-09-15'),
  (3, 5, '2023-05-01'), (3, 1, '2022-10-01'),
  (4, 1, '2023-02-01'), (4, 3, '2023-02-03'), (4, 5, '2023-03-10'),
  (5, 3, '2023-03-20'),
  (6, 5, '2023-08-01'), (6, 7, '2024-01-20'),
  (7, 1, '2024-01-10'), (7, 8, '2024-03-01'),
  (8, 5, '2024-02-25'), (8, 3, '2024-03-02');
`;

const banco = `
CREATE TABLE cuentas (
  id INTEGER PRIMARY KEY,
  titular TEXT NOT NULL,
  saldo REAL NOT NULL CHECK (saldo >= 0)
);
CREATE TABLE movimientos (
  id INTEGER PRIMARY KEY,
  cuenta_id INTEGER NOT NULL REFERENCES cuentas(id),
  importe REAL NOT NULL,
  concepto TEXT NOT NULL,
  fecha DATE NOT NULL
);
INSERT INTO cuentas (id, titular, saldo) VALUES
  (1, 'Ana', 1000),
  (2, 'Beto', 250),
  (3, 'Clara', 5000);
INSERT INTO movimientos (id, cuenta_id, importe, concepto, fecha) VALUES
  (1, 1, 1200, 'Nómina', '2024-05-01'),
  (2, 1, -200, 'Alquiler', '2024-05-03'),
  (3, 2, 300, 'Regalo', '2024-05-04'),
  (4, 2, -50, 'Cine', '2024-05-09'),
  (5, 3, 5000, 'Ahorro', '2024-05-10');
`;

const vuelos = `
CREATE TABLE aeropuertos (
  codigo TEXT PRIMARY KEY,
  ciudad TEXT NOT NULL,
  pais TEXT NOT NULL
);
CREATE TABLE vuelos (
  id INTEGER PRIMARY KEY,
  origen TEXT NOT NULL REFERENCES aeropuertos(codigo),
  destino TEXT NOT NULL REFERENCES aeropuertos(codigo),
  salida TIMESTAMP NOT NULL,
  llegada TIMESTAMP NOT NULL,
  precio REAL NOT NULL
);
INSERT INTO aeropuertos (codigo, ciudad, pais) VALUES
  ('MAD', 'Madrid', 'España'),
  ('BCN', 'Barcelona', 'España'),
  ('LIS', 'Lisboa', 'Portugal'),
  ('CDG', 'París', 'Francia'),
  ('LHR', 'Londres', 'Reino Unido'),
  ('JFK', 'Nueva York', 'Estados Unidos'),
  ('EZE', 'Buenos Aires', 'Argentina');
INSERT INTO vuelos (id, origen, destino, salida, llegada, precio) VALUES
  (1, 'MAD', 'BCN', '2025-03-10 07:00:00', '2025-03-10 08:15:00', 59.00),
  (2, 'BCN', 'MAD', '2025-03-10 20:00:00', '2025-03-10 21:15:00', 64.00),
  (3, 'MAD', 'LIS', '2025-03-11 09:30:00', '2025-03-11 09:50:00', 79.00),
  (4, 'LIS', 'LHR', '2025-03-11 12:00:00', '2025-03-11 15:10:00', 110.00),
  (5, 'MAD', 'CDG', '2025-03-11 08:00:00', '2025-03-11 10:20:00', 95.00),
  (6, 'CDG', 'LHR', '2025-03-11 13:00:00', '2025-03-11 13:20:00', 70.00),
  (7, 'LHR', 'JFK', '2025-03-12 10:00:00', '2025-03-12 13:05:00', 420.00),
  (8, 'MAD', 'JFK', '2025-03-12 11:00:00', '2025-03-12 13:50:00', 610.00),
  (9, 'MAD', 'EZE', '2025-03-13 23:30:00', '2025-03-14 10:00:00', 780.00),
  (10, 'BCN', 'CDG', '2025-03-12 07:45:00', '2025-03-12 09:35:00', 85.00),
  (11, 'CDG', 'JFK', '2025-03-13 11:00:00', '2025-03-13 13:30:00', 520.00),
  (12, 'JFK', 'EZE', '2025-03-14 22:00:00', '2025-03-15 08:30:00', 640.00);
`;

/** 6.000 ventas generadas con fórmulas (siempre las mismas): para ver lo que cambia un índice. */
const ventas_grande = `
CREATE TABLE ventas (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL,
  producto TEXT NOT NULL,
  importe REAL NOT NULL,
  fecha DATE NOT NULL
);
INSERT INTO ventas (id, cliente_id, producto, importe, fecha)
SELECT g,
       (g * 7919) % 500 + 1,
       CASE g % 5 WHEN 0 THEN 'teclado' WHEN 1 THEN 'raton' WHEN 2 THEN 'monitor' WHEN 3 THEN 'cable' ELSE 'webcam' END,
       ((g * 37) % 190) + 10 + ((g * 11) % 100) / 100.0,
       date('2024-01-01', '+' || (g % 365) || ' days')
FROM generate_series(1, 6000) AS g;
`;

export const DATASETS: Record<string, Dataset> = {
  tienda: { id: 'tienda', title: 'TiendaTech', emoji: '🛒', blurb: 'Clientes, productos y pedidos de una tienda de informática.', script: tienda },
  cine: { id: 'cine', title: 'Cine', emoji: '🎬', blurb: 'Películas, directores, actores y repartos.', script: cine },
  escuela: { id: 'escuela', title: 'Escuela', emoji: '🎓', blurb: 'Alumnos, asignaturas, profesores y notas.', script: escuela },
  empresa: { id: 'empresa', title: 'Empresa', emoji: '🏢', blurb: 'Empleados con su jefe, departamentos y proyectos.', script: empresa },
  biblioteca: { id: 'biblioteca', title: 'Biblioteca', emoji: '📚', blurb: 'Libros, autores, socios y préstamos.', script: biblioteca },
  social: { id: 'social', title: 'Red social', emoji: '💬', blurb: 'Usuarios, publicaciones y quién sigue a quién.', script: social },
  banco: { id: 'banco', title: 'Banco', emoji: '🏦', blurb: 'Cuentas y movimientos (para practicar transacciones).', script: banco },
  vuelos: { id: 'vuelos', title: 'Vuelos', emoji: '✈️', blurb: 'Aeropuertos y vuelos para buscar rutas.', script: vuelos },
  ventas_grande: { id: 'ventas_grande', title: 'Ventas (6.000 filas)', emoji: '📈', blurb: 'Muchas filas para ver qué hace un índice.', script: ventas_grande },
  vacia: { id: 'vacia', title: 'Base vacía', emoji: '🆕', blurb: 'Sin tablas: créalas tú.', script: '' },
};

export const DATASET_LIST: Dataset[] = Object.values(DATASETS);
