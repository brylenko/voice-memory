import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class DayQueryDto {
  /** Local calendar date, defaults to today in the device's time zone. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  /** Device UTC offset in minutes east of UTC (e.g. 180 for UTC+3). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-14 * 60)
  @Max(14 * 60)
  tzOffsetMinutes?: number;
}
