import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { ExportFilters, ExportFormat, ExportType } from '../exports.service';

export class CreateExportDto {
  @ApiProperty({
    enum: ['payments', 'customers', 'invoices', 'refunds', 'ledger'],
  })
  @IsIn(['payments', 'customers', 'invoices', 'refunds', 'ledger'])
  resource: ExportType;

  @ApiPropertyOptional({ enum: ['csv', 'pdf'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'pdf'])
  format: ExportFormat = 'csv';

  @ApiPropertyOptional({ description: 'Include records created at or after this ISO 8601 date.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Exclude records created at or after this ISO 8601 date.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Filter by the resource status when supported.' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by ISO currency when supported.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Additional supported filters for the selected resource.' })
  @IsOptional()
  @IsObject()
  filters?: ExportFilters;
}