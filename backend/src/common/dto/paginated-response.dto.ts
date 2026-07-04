export class PaginationMetaDto {
  page!: number;
  limit!: number;
  total!: number;
}

export class PaginatedResponseDto<T> {
  data!: T[];
  meta!: PaginationMetaDto;
}
